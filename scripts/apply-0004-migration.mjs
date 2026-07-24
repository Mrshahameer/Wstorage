import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://ckokftkmoqjyjizotlim.supabase.co";
const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrb2tmdGttb3FqeWppem90bGltIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDA1NTMzNCwiZXhwIjoyMDk5NjMxMzM0fQ.ZA9bh2loAnU6KLEf7_E7IsyGFYH6EE0vW1hGX8JLgUA";

const db = createClient(supabaseUrl, serviceKey, { db: { schema: "wstorage" } });

async function verify() {
  const { data: categories } = await db.from("categories").select("*");
  const { data: folders } = await db.from("folders").select("*");
  console.log("Seeded Categories:", categories);
  console.log("Seeded Folders:", folders);
}

verify();
