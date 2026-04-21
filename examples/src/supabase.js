import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

function missingSupabaseClient() {
    const missingConfigError = () => new Error(
        'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY.'
    );

    return {
        auth: {
            getSession: async () => ({ data: { session: null }, error: missingConfigError() }),
            onAuthStateChange: () => ({
                data: {
                    subscription: {
                        unsubscribe() {}
                    }
                }
            }),
            signInWithOtp: async () => ({ error: missingConfigError() }),
            verifyOtp: async () => ({ error: missingConfigError() }),
            signOut: async () => ({ error: null })
        },
        storage: {
            from: () => ({
                upload: async () => ({ error: missingConfigError() }),
                remove: async () => ({ error: missingConfigError() }),
                createSignedUrl: async () => ({ data: null, error: missingConfigError() })
            })
        },
        from: () => ({
            insert: () => ({
                select: () => ({
                    single: async () => ({ data: null, error: missingConfigError() })
                })
            }),
            select: () => ({
                eq: () => ({
                    order: async () => ({ data: null, error: missingConfigError() })
                })
            }),
            delete: () => ({
                eq: async () => ({ error: missingConfigError() })
            })
        })
    };
}

export const supabase = isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseKey)
    : missingSupabaseClient();
