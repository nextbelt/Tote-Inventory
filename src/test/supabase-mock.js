// Test double: forces the app into local (localStorage) mode so tests are
// hermetic and can never touch the real household database.
export const supabase = null;
