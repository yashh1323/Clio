import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co"
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key"

// Default export uses the ANON key (runs with RLS, safe for general client use)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase = createClient<any>(supabaseUrl, anonKey)

// Separate admin client factory uses the SERVICE ROLE key (bypasses RLS for secure server operations)
export const createSupabaseAdmin = () => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || anonKey
    if (process.env.NODE_ENV === "production" && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.warn("[Clio Security Warning] SUPABASE_SERVICE_ROLE_KEY is missing in production environment. Admin queries will fall back to anon key and may fail RLS policies.")
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return createClient<any>(supabaseUrl, serviceKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    })
}
