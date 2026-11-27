import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co"
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key"

// Default export uses the ANON key (runs with RLS, safe for general client use)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase = createClient<any>(supabaseUrl, anonKey)

// Separate admin client factory uses the SERVICE ROLE key (bypasses RLS for secure server operations)
export const createSupabaseAdmin = () => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const serverUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!serviceKey || !serverUrl) throw new Error("Server database credentials are missing")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return createClient<any>(serverUrl, serviceKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    })
}
