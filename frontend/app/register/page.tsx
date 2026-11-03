"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
    Loader2,
    CheckCircle,
    XCircle,
    User,
    Mail,
    Lock,
    GraduationCap,
    BookOpen,
    ArrowLeft,
    Eye,
    EyeOff,
} from "lucide-react"
import { WebGLShader } from "@/components/ui/web-gl-shader"

export default function RegisterPage() {
    const router = useRouter()

    // Form fields
    const [username, setUsername] = useState("")
    const [fullName, setFullName] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [role, setRole] = useState<"student" | "teacher">("student")
    const [course, setCourse] = useState("")
    const [studentClass, setStudentClass] = useState("")
    const [inviteCode, setInviteCode] = useState("")

    // UI state
    const [showPassword, setShowPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        // Client-side validation
        if (!username.trim() || !email.trim() || !password) {
            setError("Username, email, and password are required")
            return
        }
        if (username.trim().length < 3) {
            setError("Username must be at least 3 characters")
            return
        }
        if (!/^[a-zA-Z0-9_.-]+$/.test(username.trim())) {
            setError("Username can only contain letters, numbers, dots, hyphens, and underscores")
            return
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            setError("Please enter a valid email address")
            return
        }
        if (password.length < 6) {
            setError("Password must be at least 6 characters")
            return
        }
        if (password !== confirmPassword) {
            setError("Passwords do not match")
            return
        }

        setLoading(true)
        try {
            const res = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username: username.trim(),
                    full_name: fullName.trim(),
                    email: email.trim(),
                    password,
                    role,
                    course: course.trim(),
                    student_class: studentClass.trim(),
                    invite_code: role === "teacher" ? inviteCode.trim() : undefined,
                }),
            })

            const data = await res.json()
            if (!res.ok) {
                setError(data.error || "Registration failed")
                return
            }

            setSuccess(true)
        } catch {
            setError("Network error — please try again")
        } finally {
            setLoading(false)
        }
    }

    // Redirect to login after success with cleanup
    useEffect(() => {
        if (success) {
            const id = setTimeout(() => router.push("/login"), 2000)
            return () => clearTimeout(id)
        }
    }, [success, router])

    if (success) {
        return (
            <div className="relative min-h-screen w-full bg-black">
                <div className="fixed inset-0 z-0 opacity-40"><WebGLShader /></div>
                <div className="relative z-10 flex min-h-screen items-center justify-center">
                    <div className="text-center space-y-4 animate-in fade-in zoom-in duration-500">
                        <div className="mx-auto h-16 w-16 rounded-2xl bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                            <CheckCircle className="h-8 w-8 text-green-400" />
                        </div>
                        <h2 className="text-xl font-bold text-white">Account Created!</h2>
                        <p className="text-sm text-white/50">Redirecting you to login…</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="relative min-h-screen w-full bg-background text-foreground font-sans">
            {/* Background */}
            <div className="fixed inset-0 z-0 opacity-30">
                <WebGLShader />
            </div>

            <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12">
                <div className="w-full max-w-lg">
                    {/* Back to Login */}
                    <button
                        onClick={() => router.push("/login")}
                        className="flex items-center gap-2 text-white/40 hover:text-white/70 transition-colors mb-8"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        <span className="text-sm">Back to Login</span>
                    </button>

                    {/* Card */}
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md overflow-hidden">
                        {/* Header */}
                        <div className="px-8 pt-8 pb-6 border-b border-white/5">
                            <div className="flex items-center gap-4">
                                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
                                    <User className="h-6 w-6 text-white" />
                                </div>
                                <div>
                                    <h1 className="text-xl font-bold text-white">Create Account</h1>
                                    <p className="text-xs text-white/40 mt-0.5">Join Clio — Academic Integrity Platform</p>
                                </div>
                            </div>
                        </div>

                        {/* Form */}
                        <form onSubmit={handleSubmit} className="px-8 py-6 space-y-5">
                            {/* Role Selector */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">I am a</label>
                                <div className="flex gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setRole("student")}
                                        className={`flex-1 flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-all ${role === "student"
                                            ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
                                            : "border-white/10 bg-white/5 text-white/50 hover:border-white/20"
                                            }`}
                                    >
                                        <BookOpen className="h-4 w-4" />Student
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setRole("teacher")}
                                        className={`flex-1 flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-all ${role === "teacher"
                                            ? "border-purple-500/40 bg-purple-500/10 text-purple-400"
                                            : "border-white/10 bg-white/5 text-white/50 hover:border-white/20"
                                            }`}
                                    >
                                        <GraduationCap className="h-4 w-4" />Teacher
                                    </button>
                                </div>
                            </div>

                            {/* Username */}
                            <div className="space-y-2">
                                <label htmlFor="username" className="flex items-center gap-1.5 text-xs font-semibold text-white/50 uppercase tracking-wider">
                                    <User className="h-3.5 w-3.5" />Username
                                </label>
                                <input
                                    id="username"
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="e.g. john_doe"
                                    maxLength={50}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                                />
                            </div>

                            {/* Full Name */}
                            <div className="space-y-2">
                                <label htmlFor="fullName" className="flex items-center gap-1.5 text-xs font-semibold text-white/50 uppercase tracking-wider">
                                    <User className="h-3.5 w-3.5" />Full Name
                                </label>
                                <input
                                    id="fullName"
                                    type="text"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    placeholder="Your full name"
                                    maxLength={200}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                                />
                            </div>

                            {/* Email */}
                            <div className="space-y-2">
                                <label htmlFor="email" className="flex items-center gap-1.5 text-xs font-semibold text-white/50 uppercase tracking-wider">
                                    <Mail className="h-3.5 w-3.5" />University Email
                                </label>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="you@university.edu"
                                    maxLength={254}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                                />
                            </div>

                            {/* Student-specific fields */}
                            {role === "student" && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label htmlFor="studentClass" className="flex items-center gap-1.5 text-xs font-semibold text-white/50 uppercase tracking-wider">
                                            <GraduationCap className="h-3.5 w-3.5" />Class / Section
                                        </label>
                                        <input
                                            id="studentClass"
                                            type="text"
                                            value={studentClass}
                                            onChange={(e) => setStudentClass(e.target.value)}
                                            placeholder="e.g. CSE-2024"
                                            maxLength={100}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label htmlFor="course" className="flex items-center gap-1.5 text-xs font-semibold text-white/50 uppercase tracking-wider">
                                            <BookOpen className="h-3.5 w-3.5" />Course
                                        </label>
                                        <input
                                            id="course"
                                            type="text"
                                            value={course}
                                            onChange={(e) => setCourse(e.target.value)}
                                            placeholder="e.g. Computer Science"
                                            maxLength={200}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Teacher-specific fields */}
                            {role === "teacher" && (
                                <div className="space-y-2">
                                    <label htmlFor="inviteCode" className="flex items-center gap-1.5 text-xs font-semibold text-white/50 uppercase tracking-wider">
                                        <Lock className="h-3.5 w-3.5" />Teacher Invite Code (if required)
                                    </label>
                                    <input
                                        id="inviteCode"
                                        type="password"
                                        value={inviteCode}
                                        onChange={(e) => setInviteCode(e.target.value)}
                                        placeholder="Enter faculty invite code"
                                        maxLength={200}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                                    />
                                </div>
                            )}

                            {/* Password */}
                            <div className="space-y-2">
                                <label htmlFor="password" className="flex items-center gap-1.5 text-xs font-semibold text-white/50 uppercase tracking-wider">
                                    <Lock className="h-3.5 w-3.5" />Password
                                </label>
                                <div className="relative">
                                    <input
                                        id="password"
                                        type={showPassword ? "text" : "password"}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Min. 6 characters"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-12 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((v) => !v)}
                                        aria-label={showPassword ? "Hide password" : "Show password"}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                                    >
                                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>

                            {/* Confirm Password */}
                            <div className="space-y-2">
                                <label htmlFor="confirmPassword" className="flex items-center gap-1.5 text-xs font-semibold text-white/50 uppercase tracking-wider">
                                    <Lock className="h-3.5 w-3.5" />Confirm Password
                                </label>
                                <input
                                    id="confirmPassword"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder="Re-enter password"
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all"
                                />
                            </div>

                            {/* Error */}
                            {error && (
                                <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 animate-in fade-in">
                                    <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                                    <span className="text-sm text-red-400">{error}</span>
                                </div>
                            )}

                            {/* Submit */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full inline-flex items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-8 py-3.5 text-sm font-semibold text-white hover:from-purple-500 hover:to-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30"
                            >
                                {loading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <CheckCircle className="h-4 w-4" />
                                )}
                                {loading ? "Creating Account…" : "Create Account"}
                            </button>

                            {/* Login link */}
                            <p className="text-center text-xs text-white/30">
                                Already have an account?{" "}
                                <button
                                    type="button"
                                    onClick={() => router.push("/login")}
                                    className="text-purple-400 hover:text-purple-300 transition-colors font-medium"
                                >
                                    Sign In
                                </button>
                            </p>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    )
}
