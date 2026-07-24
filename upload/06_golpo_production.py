"""
golpo_production.py
────────────────────────────────────────────────────────────────────────────
Full production Golpo reveal engine. Nothing stubbed.

Pipeline:
  1. SEGMENT   — worker.py's extract_atomic_regions() (convex-hull-merged
                 connected components) gives atomic regions. Group them into
                 Elements (a VLM would normally do this grouping; here you
                 can pass explicit region-id groups).
  2. MEASURE   — for each element, actually compute its ink_ticks / fill_ticks
                 / stroke count / region count at a neutral default setting.
                 This is empirical, not guessed — see measure_element().
  3. BUDGET    — given per-element weights (or explicit tick_budget), solve
                 the px_per_tick and fill-steps that make each element's
                 sketch phase land near its assigned tick budget:
                   - solve_px_per_tick(): binary search, ink_ticks(ppt) is
                     monotonic non-increasing, floored at n_strokes.
                   - solve_fill_steps(): fill_ticks ≈ steps * n_regions, so
                     steps = round(target / n_regions).
  4. SCHEDULE  — run elements as a set of generators on a shared timeline.
                 Element i+1 starts `cross_element_lead` ticks before element
                 i finishes (real overlap: both generators mutate the shared
                 canvas in the same ticks), instead of a hard stop-start.
  5. RENDER    — write every tick to a raw video (no skipping → no jumpiness).
  6. BUDGET DURATION — re-encode at fps = frames_written / target_seconds.
                 Every frame kept, so duration is exact by construction,
                 independent of how many elements / ticks / modes were used.
────────────────────────────────────────────────────────────────────────────
"""

import sys
import subprocess
import numpy as np
import cv2

sys.path.insert(0, '/home/claude')
from golpo_reveal__2_ import (
    sketchify_preprocess,
    trace_ink_strokes,
    ink_stroke_steps,
    _object_subregions,
    _order_strokes_topdown,
)

# ─────────────────────────────────────────────────────────────────────────
# 0. SEGMENTATION — pure image-processing functions lifted from worker.py
#    (the job-orchestration parts of worker.py depend on packages that
#    aren't part of this pipeline, so only the CV logic is reused here)
# ─────────────────────────────────────────────────────────────────────────
def compute_foreground(img: np.ndarray) -> np.ndarray:
    mask = (np.sum(img, axis=2) <= 705).astype(np.uint8) * 255
    mask[:5, :] = 0
    mask[-5:, :] = 0
    mask[:, :5] = 0
    mask[:, -5:] = 0
    return mask


def fill_shape_hull(mask: np.ndarray) -> np.ndarray:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(mask)
    if contours:
        all_pts = np.vstack(contours)
        hull = cv2.convexHull(all_pts)
        cv2.drawContours(filled, [hull], -1, 255, -1)
    return filled


def extract_atomic_regions(foreground_mask: np.ndarray, min_area: int = 80):
    h, w = foreground_mask.shape[:2]
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    closed = cv2.morphologyEx(foreground_mask, cv2.MORPH_CLOSE, kernel)
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(closed)

    raw_regions = []
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < min_area:
            continue
        mask = (labels == i).astype(np.uint8) * 255
        mask = cv2.bitwise_and(mask, foreground_mask)
        if np.sum(mask) == 0:
            continue
        x, y, cw, ch = stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP], stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
        cx, cy = centroids[i]
        raw_regions.append({"mask": mask, "box": [x, y, x + cw, y + ch],
                             "centroid": [cx, cy], "area": int((mask > 0).sum()), "merged": False})

    raw_regions.sort(key=lambda r: r["area"], reverse=True)
    filled_masks = [fill_shape_hull(r["mask"]) for r in raw_regions]

    for i in range(len(raw_regions)):
        if raw_regions[i]["merged"]:
            continue
        filled_parent = filled_masks[i]
        for j in range(i + 1, len(raw_regions)):
            if raw_regions[j]["merged"]:
                continue
            child_mask = raw_regions[j]["mask"]
            overlap_mask = cv2.bitwise_and(child_mask, filled_parent)
            overlap_area = np.sum(overlap_mask > 0)
            child_area = np.sum(child_mask > 0)
            if child_area > 0 and (overlap_area / child_area) >= 0.85:
                raw_regions[i]["mask"] = cv2.bitwise_or(raw_regions[i]["mask"], raw_regions[j]["mask"])
                filled_masks[i] = cv2.bitwise_or(filled_masks[i], filled_masks[j])
                raw_regions[j]["merged"] = True

    active_regions = [r for r in raw_regions if not r["merged"]]
    for r in active_regions:
        contours, _ = cv2.findContours(r["mask"], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            x, y, bw, bh = cv2.boundingRect(np.vstack(contours))
            r["box"] = [x, y, x + bw, y + bh]
            M = cv2.moments(r["mask"])
            if M["m00"] > 0:
                r["centroid"] = [M["m10"] / M["m00"], M["m01"] / M["m00"]]
            else:
                r["centroid"] = [x + bw / 2, y + bh / 2]
            r["area"] = int((r["mask"] > 0).sum())

    active_regions.sort(key=lambda r: (round(r["centroid"][1] / 40.0), r["centroid"][0]))
    regions = []
    for idx, r in enumerate(active_regions):
        bx = r["box"]
        regions.append({"id": idx, "mask": r["mask"],
                         "box_norm": [bx[0] / w, bx[1] / h, bx[2] / w, bx[3] / h],
                         "centroid_norm": [r["centroid"][0] / w, r["centroid"][1] / h],
                         "area": r["area"]})
    return regions


# ─────────────────────────────────────────────────────────────────────────
# 1. ELEMENT
# ─────────────────────────────────────────────────────────────────────────
class Element:
    """
    One reveal unit, built from one or more worker.py regions OR'd together.

    weight        : relative share of the SKETCH tick budget vs other sketch
                     elements (ignored for slide_in elements). Default 1.0.
    tick_budget   : explicit override — if set, weight is ignored and this
                     element is budgeted to exactly this many raw ticks
                     (subject to the stroke-count / region-count floor, see
                     solve_px_per_tick / solve_fill_steps).
    """
    def __init__(self, id, mask, mode='sketch', weight=1.0, tick_budget=None,
                 slide_from='left', slide_ticks=18):
        self.id = id
        self.mask = mask
        self.mode = mode                  # 'sketch' | 'slide_in'
        self.weight = weight
        self.tick_budget = tick_budget
        self.slide_from = slide_from
        self.slide_ticks = slide_ticks
        # filled in by measure_element() / budget_elements()
        self.n_strokes = None
        self.n_regions = None
        self.measured_ink_ticks = None
        self.measured_fill_ticks = None
        self.solved_px_per_tick = None
        self.solved_fill_steps = None
        self.strokes = None
        self.region_id = None
        self.region_meta = None


# ─────────────────────────────────────────────────────────────────────────
# 2. MEASUREMENT — empirical, not guessed. Actually traces strokes / builds
#    regions and counts ticks at a neutral baseline before any budgeting.
# ─────────────────────────────────────────────────────────────────────────
BASELINE_PPT = 20     # neutral px_per_tick used only for measurement
BASELINE_STEPS = 25   # neutral fill-steps used only for measurement
MIN_LEN = 14


def measure_element(el, flat_bgr, ink_mask):
    obj_ink = cv2.bitwise_and(ink_mask, ink_mask, mask=el.mask)
    strokes = _order_strokes_topdown(trace_ink_strokes(obj_ink, min_len=MIN_LEN))
    region_id, region_meta = _object_subregions(flat_bgr, el.mask)

    ink_ticks = sum(int(np.ceil(len(s) / BASELINE_PPT)) for s in strokes) if strokes else 0
    fill_ticks = 0
    for mid, _ in region_meta:
        total = int((region_id == mid).sum())
        chunk = max(1, total // BASELINE_STEPS)
        fill_ticks += int(np.ceil(total / chunk))

    el.strokes = strokes
    el.region_id = region_id
    el.region_meta = region_meta
    el.n_strokes = len(strokes)
    el.n_regions = len(region_meta)
    el.measured_ink_ticks = ink_ticks
    el.measured_fill_ticks = fill_ticks
    return ink_ticks, fill_ticks


# ─────────────────────────────────────────────────────────────────────────
# 3. BUDGET SOLVING
# ─────────────────────────────────────────────────────────────────────────
def solve_px_per_tick(strokes, target_ticks):
    """Smallest px_per_tick such that ink_ticks(ppt) <= target_ticks.
    ink_ticks is monotonic non-increasing in ppt, floored at n_strokes
    (every stroke costs >= 1 tick no matter how large ppt gets)."""
    lengths = [len(s) for s in strokes]
    if not lengths:
        return BASELINE_PPT
    n_strokes = len(lengths)
    target_ticks = max(target_ticks, n_strokes)

    def ticks_at(ppt):
        return sum(-(-l // ppt) for l in lengths)  # ceil division

    lo, hi = 1, max(lengths)
    best = hi
    while lo <= hi:
        mid = (lo + hi) // 2
        t = ticks_at(mid)
        if t <= target_ticks:
            best = mid
            hi = mid - 1
        else:
            lo = mid + 1
    return best


def solve_fill_steps(n_regions, target_ticks):
    """fill_ticks ~= steps * n_regions -> steps = target / n_regions."""
    if n_regions == 0:
        return BASELINE_STEPS
    return max(1, round(target_ticks / n_regions))


def budget_elements(elements, total_sketch_tick_budget, ink_fraction=0.35):
    """
    Distribute total_sketch_tick_budget across all 'sketch' elements
    proportional to weight (or exact tick_budget if given), then solve each
    element's px_per_tick / fill_steps to hit its share.
    ink_fraction is how much of an element's own budget goes to the ink
    phase vs the fill phase (default 35/65, matching the natural ratio
    observed across the three renders in GOLPO_PIPELINE_NOTES.md).
    """
    sketch_els = [e for e in elements if e.mode == 'sketch']
    explicit = [e for e in sketch_els if e.tick_budget is not None]
    implicit = [e for e in sketch_els if e.tick_budget is None]

    remaining_budget = total_sketch_tick_budget - sum(e.tick_budget for e in explicit)
    total_weight = sum(e.weight for e in implicit) or 1.0

    for e in explicit:
        target = e.tick_budget
        _solve_one(e, target, ink_fraction)

    for e in implicit:
        share = remaining_budget * (e.weight / total_weight) if remaining_budget > 0 else e.measured_ink_ticks + e.measured_fill_ticks
        _solve_one(e, share, ink_fraction)

    return elements


def _solve_one(e, target_total_ticks, ink_fraction):
    target_ink = max(e.n_strokes, int(target_total_ticks * ink_fraction))
    target_fill = max(e.n_regions, int(target_total_ticks * (1 - ink_fraction)))
    e.solved_px_per_tick = solve_px_per_tick(e.strokes, target_ink)
    e.solved_fill_steps = solve_fill_steps(e.n_regions, target_fill)


# ─────────────────────────────────────────────────────────────────────────
# 4. LOCAL region-fill generator with a PARAMETRIZED step count (the
#    original engine hardcodes steps=25; this is needed for budgeting)
# ─────────────────────────────────────────────────────────────────────────
def region_fill_steps_budgeted(canvas, flat_bgr, object_mask, region_id, region_meta,
                                paint_src, sweep_direction='tb', steps=25):
    src = paint_src if paint_src is not None else flat_bgr
    for mid, _ in region_meta:
        rmask = region_id == mid
        ys, xs = np.where(rmask)
        if len(ys) == 0:
            continue
        if sweep_direction == 'tb':
            idx = np.argsort(ys)
        elif sweep_direction == 'bt':
            idx = np.argsort(-ys)
        elif sweep_direction == 'lr':
            idx = np.argsort(xs)
        elif sweep_direction == 'rl':
            idx = np.argsort(-xs)
        else:
            idx = np.arange(len(ys))
        ys_sorted, xs_sorted = ys[idx], xs[idx]
        total = len(ys_sorted)
        chunk_size = max(1, total // steps)
        for i in range(0, total, chunk_size):
            sy = ys_sorted[i:i + chunk_size]
            sx = xs_sorted[i:i + chunk_size]
            canvas[sy, sx] = src[sy, sx]
            yield


# ─────────────────────────────────────────────────────────────────────────
# 5. PER-ELEMENT TICK GENERATORS (sketch uses solved params; slide_in fixed)
# ─────────────────────────────────────────────────────────────────────────
def sketch_ticks(canvas, src, el, ink_mask, flat_bgr, ink_thickness=2, lead_frames=6,
                  sweep_direction='tb'):
    obj_ink = cv2.bitwise_and(ink_mask, ink_mask, mask=el.mask)
    outline_accum = np.zeros(canvas.shape[:2], np.uint8)
    ink_gen = ink_stroke_steps(canvas, outline_accum, el.strokes, (30, 30, 30),
                                thickness=ink_thickness, px_per_tick=el.solved_px_per_tick,
                                real_ink=obj_ink, src=src)
    color_gen = region_fill_steps_budgeted(canvas, flat_bgr, el.mask, el.region_id, el.region_meta,
                                            paint_src=src, sweep_direction=sweep_direction,
                                            steps=el.solved_fill_steps)

    ink_ticks = sum(int(np.ceil(len(s) / el.solved_px_per_tick)) for s in el.strokes) or 1
    fill_ticks = 0
    for mid, _ in el.region_meta:
        total = int((el.region_id == mid).sum())
        chunk = max(1, total // el.solved_fill_steps)
        fill_ticks += int(np.ceil(total / chunk))
    color_ratio = fill_ticks / float(max(1, ink_ticks))

    ink_done = color_done = False
    ink_count = color_count = 0
    while not (ink_done and color_done):
        if not ink_done:
            try:
                next(ink_gen); ink_count += 1
            except StopIteration:
                ink_done = True
        if not color_done and (ink_done or ink_count > lead_frames):
            if not ink_done:
                tgt = int((ink_count - lead_frames) * color_ratio)
                while color_count < tgt and not color_done:
                    try:
                        next(color_gen); color_count += 1
                    except StopIteration:
                        color_done = True
            else:
                try:
                    next(color_gen); color_count += 1
                except StopIteration:
                    color_done = True
        yield


def slide_in_ticks(canvas, src, el, h, w):
    ys, xs = np.where(el.mask > 0)
    if len(xs) == 0:
        return
    x1, y1, x2, y2 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    sprite = src[y1:y2, x1:x2].copy()
    sprite_mask = el.mask[y1:y2, x1:x2]

    dx = dy = 0
    if el.slide_from == 'left':
        dx = -(x2) - 40
    elif el.slide_from == 'right':
        dx = (w - x1) + 40
    elif el.slide_from == 'top':
        dy = -(y2) - 40
    elif el.slide_from == 'bottom':
        dy = (h - y1) + 40

    n = max(1, el.slide_ticks)
    for i in range(n):
        t = (i + 1) / n
        ease = 1 - (1 - t) ** 3
        cx = x1 + int(dx * (1 - ease))
        cy = y1 + int(dy * (1 - ease))
        _stamp(canvas, sprite, sprite_mask, cx, cy, h, w)
        yield
    _stamp(canvas, sprite, sprite_mask, x1, y1, h, w)


def _stamp(canvas, sprite, sprite_mask, x, y, h, w):
    sh, sw = sprite.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1c, y1c = min(w, x + sw), min(h, y + sh)
    if x1c <= x0 or y1c <= y0:
        return
    sx0, sy0 = x0 - x, y0 - y
    sx1, sy1 = sx0 + (x1c - x0), sy0 + (y1c - y0)
    region = canvas[y0:y1c, x0:x1c]
    m = sprite_mask[sy0:sy1, sx0:sx1] > 0
    region[m] = sprite[sy0:sy1, sx0:sx1][m]


# ─────────────────────────────────────────────────────────────────────────
# 6. SCHEDULER — real cross-element overlap (both generators mutate the
#    shared canvas within the same ticks during the overlap window)
# ─────────────────────────────────────────────────────────────────────────
def scheduled_ticks(canvas, src, elements, ink_mask, flat_bgr, h, w,
                     cross_element_lead=4, ink_thickness=2, lead_frames=6):
    def make_gen(el):
        if el.mode == 'sketch':
            return sketch_ticks(canvas, src, el, ink_mask, flat_bgr,
                                 ink_thickness=ink_thickness, lead_frames=lead_frames)
        else:
            return slide_in_ticks(canvas, src, el, h, w)

    def expected_len(el):
        if el.mode == 'sketch':
            ink_ticks = sum(int(np.ceil(len(s) / el.solved_px_per_tick)) for s in el.strokes) or 1
            fill_ticks = 0
            for mid, _ in el.region_meta:
                total = int((el.region_id == mid).sum())
                chunk = max(1, total // el.solved_fill_steps)
                fill_ticks += int(np.ceil(total / chunk))
            return ink_ticks + max(0, fill_ticks - int(ink_ticks * (fill_ticks / max(1, ink_ticks))))  # rough
        return el.slide_ticks

    n = len(elements)
    if n == 0:
        return
    active = [[make_gen(elements[0]), expected_len(elements[0])]]
    idx = 1

    while active:
        still_active = []
        for g in active:
            try:
                next(g[0])
                g[1] -= 1
                still_active.append(g)
            except StopIteration:
                pass
        active = still_active

        if idx < n:
            if not active or active[0][1] <= cross_element_lead:
                active.append([make_gen(elements[idx]), expected_len(elements[idx])])
                idx += 1
        yield


# ─────────────────────────────────────────────────────────────────────────
# 7. TOP-LEVEL RENDER — full pipeline, exact duration guaranteed
# ─────────────────────────────────────────────────────────────────────────
def render_production(img_bgr, elements, out_path, target_seconds,
                       total_sketch_tick_budget=None, ink_fraction=0.35,
                       n_colors=14, fps_hint=30, hold_seconds=1.0,
                       cross_element_lead=4, ink_thickness=2, lead_frames=6,
                       verbose=True):
    h, w = img_bgr.shape[:2]
    flat_bgr, ink_mask = sketchify_preprocess(img_bgr, n_colors=n_colors)

    # ---- MEASURE (empirical) ----
    for el in elements:
        measure_element(el, flat_bgr, ink_mask)

    measured_ink = sum(e.measured_ink_ticks for e in elements if e.mode == 'sketch')
    measured_fill = sum(e.measured_fill_ticks for e in elements if e.mode == 'sketch')
    if total_sketch_tick_budget is None:
        total_sketch_tick_budget = measured_ink + measured_fill  # no override -> use natural measurement

    if verbose:
        print(f"[measure] {len(elements)} elements | baseline sketch ticks "
              f"ink={measured_ink} fill={measured_fill} (ppt={BASELINE_PPT}, steps={BASELINE_STEPS})")

    # ---- BUDGET ----
    budget_elements(elements, total_sketch_tick_budget, ink_fraction=ink_fraction)
    if verbose:
        for e in elements:
            if e.mode == 'sketch':
                print(f"  element {e.id}: strokes={e.n_strokes} regions={e.n_regions} "
                      f"-> px_per_tick={e.solved_px_per_tick} fill_steps={e.solved_fill_steps}")
            else:
                print(f"  element {e.id}: slide_in from={e.slide_from} ticks={e.slide_ticks}")

    # ---- RENDER (write every tick, no skipping) ----
    canvas = np.full((h, w, 3), 255, np.uint8)
    raw_path = out_path + ".raw.mp4"
    writer = cv2.VideoWriter(raw_path, cv2.VideoWriter_fourcc(*'mp4v'), fps_hint, (w, h))
    frames_written = 0

    for _ in scheduled_ticks(canvas, img_bgr, elements, ink_mask, flat_bgr, h, w,
                              cross_element_lead=cross_element_lead,
                              ink_thickness=ink_thickness, lead_frames=lead_frames):
        writer.write(canvas)
        frames_written += 1

    for _ in range(int(fps_hint * hold_seconds)):
        writer.write(canvas)
        frames_written += 1
    writer.release()

    # ---- DURATION BUDGET (exact, content-independent) ----
    final_fps = frames_written / float(target_seconds)
    subprocess.run(["ffmpeg", "-y", "-r", f"{final_fps:.4f}", "-i", raw_path,
                     "-vf", "scale=1280:-2",
                     "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
                     "-preset", "fast", out_path], check=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if verbose:
        print(f"[render] raw_frames={frames_written} final_fps={final_fps:.2f} "
              f"-> duration={frames_written/final_fps:.3f}s (target {target_seconds}s)")

    return {"frames_written": frames_written, "final_fps": final_fps,
            "measured_ink_ticks": measured_ink, "measured_fill_ticks": measured_fill}
