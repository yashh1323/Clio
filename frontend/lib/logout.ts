export async function signOut(): Promise<boolean> {
    try {
        const response = await fetch("/api/auth/logout", { method: "POST" })
        if (response.ok) return true
    } catch {
        // A network failure leaves the session active.
    }
    window.alert("Sign-out did not complete. Please try again.")
    return false
}
