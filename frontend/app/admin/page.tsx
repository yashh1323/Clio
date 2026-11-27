"use client"

import { signOut } from "@/lib/logout"
import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Edit2, Shield, User, GraduationCap, Building2, FileText, FileCheck } from "lucide-react"

interface UserProfile {
    id: string
    username: string
    email: string
    full_name: string
    role: "student" | "teacher" | "admin"
    class?: string
    course?: string
    created_at: string
}

interface Assignment {
    id: string
    title: string
    teacher_name: string
    created_at: string
}

interface Submission {
    id: string
    assignment_title: string
    student_username: string
    integrity_score: number
    submitted_at: string
}

export default function AdminDashboard() {
    const router = useRouter()
    const [users, setUsers] = useState<UserProfile[]>([])
    const [assignments, setAssignments] = useState<Assignment[]>([])
    const [submissions, setSubmissions] = useState<Submission[]>([])
    const [activeTab, setActiveTab] = useState<"users" | "assignments" | "submissions">("users")
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")

    // Modals
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [isEditOpen, setIsEditOpen] = useState(false)
    const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null)

    // Form inputs
    const [formData, setFormData] = useState({
        username: "",
        password: "",
        email: "",
        full_name: "",
        role: "student",
        student_class: "",
        course: ""
    })

    const fetchUsers = useCallback(async () => {
        try {
            const res = await fetch("/api/admin/users")
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    router.push("/login")
                    return
                }
                throw new Error("Failed to load users")
            }
            const data = await res.json()
            setUsers(data.users)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Unknown error")
        } finally {
            setLoading(false)
        }
    }, [router])

    const fetchAssignments = useCallback(async () => {
        try {
            setLoading(true)
            const res = await fetch("/api/admin/assignments")
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    router.push("/login")
                    return
                }
                throw new Error("Failed to load assignments")
            }
            const data = await res.json()
            setAssignments(data.assignments)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Unknown error")
        } finally {
            setLoading(false)
        }
    }, [router])

    const fetchSubmissions = useCallback(async () => {
        try {
            setLoading(true)
            const res = await fetch("/api/admin/submissions")
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    router.push("/login")
                    return
                }
                throw new Error("Failed to load submissions")
            }
            const data = await res.json()
            setSubmissions(data.submissions)
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Unknown error")
        } finally {
            setLoading(false)
        }
    }, [router])

    useEffect(() => {
        if (activeTab === "users") fetchUsers()
        else if (activeTab === "assignments") fetchAssignments()
        else if (activeTab === "submissions") fetchSubmissions()
    }, [activeTab, fetchUsers, fetchAssignments, fetchSubmissions])

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        try {
            const res = await fetch("/api/admin/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData)
            })

            if (!res.ok) {
                const text = await res.text()
                try {
                    const err = JSON.parse(text)
                    throw new Error(err.error || err.message || text)
                } catch {
                    throw new Error(text || "Failed to create user")
                }
            }

            await res.json()
            setIsCreateOpen(false)
            setFormData({ username: "", password: "", email: "", full_name: "", role: "student", student_class: "", course: "" })
            fetchUsers()
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : "Unknown error")
        }
    }

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!selectedUser) return
        try {
            const payload: Record<string, string> = { id: selectedUser.id, role: formData.role, full_name: formData.full_name, email: formData.email }
            if (formData.password) payload.password = formData.password

            const res = await fetch("/api/admin/users", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            })

            if (!res.ok) {
                const text = await res.text()
                try {
                    const err = JSON.parse(text)
                    throw new Error(err.error || err.message || text)
                } catch {
                    throw new Error(text || "Failed to update user")
                }
            }

            await res.json()
            setIsEditOpen(false)
            fetchUsers()
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : "Unknown error")
        }
    }

    const handleDelete = async (id: string, username: string) => {
        if (!confirm(`Are you absolutely sure you want to delete user ${username}? All their data (classes, assignments, grades) will be permanently deleted.`)) return

        try {
            const res = await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" })

            if (!res.ok) {
                const text = await res.text()
                try {
                    const err = JSON.parse(text)
                    throw new Error(err.error || err.message || text)
                } catch {
                    throw new Error(text || "Failed to delete user")
                }
            }

            await res.json()
            fetchUsers()
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : "Unknown error")
        }
    }

    const handleDeleteAssignment = async (id: string, title: string) => {
        if (!confirm(`Are you sure you want to delete assignment "${title}"? All related submissions and grades will be deleted.`)) return
        try {
            const res = await fetch(`/api/admin/assignments?id=${id}`, { method: "DELETE" })
            if (!res.ok) {
                const text = await res.text()
                try {
                    const err = JSON.parse(text)
                    throw new Error(err.error || err.message || text)
                } catch {
                    throw new Error(text || "Failed to delete assignment")
                }
            }
            fetchAssignments()
        } catch (err: unknown) { alert(err instanceof Error ? err.message : "Unknown error") }
    }

    const handleDeleteSubmission = async (id: string, title: string, student: string) => {
        if (!confirm(`Are you sure you want to delete submission "${title}" by ${student}?`)) return
        try {
            const res = await fetch(`/api/admin/submissions?id=${id}`, { method: "DELETE" })
            if (!res.ok) {
                const text = await res.text()
                try {
                    const err = JSON.parse(text)
                    throw new Error(err.error || err.message || text)
                } catch {
                    throw new Error(text || "Failed to delete submission")
                }
            }
            fetchSubmissions()
        } catch (err: unknown) { alert(err instanceof Error ? err.message : "Unknown error") }
    }

    const openEditModal = (user: UserProfile) => {
        setSelectedUser(user)
        setFormData({
            username: user.username,
            password: "", // Leave blank unless they want to change it
            email: user.email || "",
            full_name: user.full_name || "",
            role: user.role,
            student_class: user.class || "",
            course: user.course || ""
        })
        setIsEditOpen(true)
    }

    const roleBadge = (role: string) => {
        switch (role) {
            case "admin": return <span className="px-2 py-1 bg-red-500/10 text-red-500 rounded-full text-xs font-medium flex items-center gap-1"><Shield className="w-3 h-3" /> Admin</span>
            case "teacher": return <span className="px-2 py-1 bg-blue-500/10 text-blue-500 rounded-full text-xs font-medium flex items-center gap-1"><Building2 className="w-3 h-3" /> Teacher</span>
            case "student": return <span className="px-2 py-1 bg-emerald-500/10 text-emerald-500 rounded-full text-xs font-medium flex items-center gap-1"><GraduationCap className="w-3 h-3" /> Student</span>
            default: return <span className="px-2 py-1 bg-zinc-800 text-zinc-400 rounded-full text-xs font-medium">{role}</span>
        }
    }

    if (loading) {
        return <div className="min-h-screen bg-black text-white flex items-center justify-center">Loading Admin Dashboard...</div>
    }

    return (
        <div className="min-h-screen bg-black text-white p-8">
            <div className="max-w-6xl mx-auto space-y-8">

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-semibold tracking-tight">Superadmin Dashboard</h1>
                        <p className="text-zinc-400 mt-1">Manage system users, roles, and permissions.</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => {
                                signOut().then(ok => { if (ok) router.push("/login") })
                            }}
                            className="text-sm text-zinc-400 hover:text-white transition-colors"
                        >
                            Log out
                        </button>
                        <button
                            onClick={() => {
                                setFormData({ username: "", password: "", email: "", full_name: "", role: "student", student_class: "", course: "" })
                                setIsCreateOpen(true)
                            }}
                            className="bg-white text-black px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-zinc-200 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            New User
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-4 border-b border-zinc-800 pb-px">
                    <button onClick={() => setActiveTab("users")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "users" ? "border-white text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}>Users</button>
                    <button onClick={() => setActiveTab("assignments")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "assignments" ? "border-white text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}>Assignments</button>
                    <button onClick={() => setActiveTab("submissions")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "submissions" ? "border-white text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}>Submissions</button>
                </div>

                {error && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm">
                        {error}
                    </div>
                )}

                {/* Users Table */}
                {activeTab === "users" && (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-zinc-400 bg-zinc-900/50 uppercase border-b border-zinc-800">
                                    <tr>
                                        <th className="px-6 py-4 font-medium">User</th>
                                        <th className="px-6 py-4 font-medium">Role</th>
                                        <th className="px-6 py-4 font-medium">Email</th>
                                        <th className="px-6 py-4 font-medium">Joined</th>
                                        <th className="px-6 py-4 font-medium text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-800">
                                    {users.map((user) => (
                                        <tr key={user.id} className="hover:bg-zinc-800/50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0">
                                                        <User className="w-4 h-4 text-zinc-400" />
                                                    </div>
                                                    <div>
                                                        <div className="font-medium text-white">{user.full_name || "Unknown Name"}</div>
                                                        <div className="text-zinc-500">@{user.username}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {roleBadge(user.role)}
                                            </td>
                                            <td className="px-6 py-4 text-zinc-300">
                                                {user.email}
                                            </td>
                                            <td className="px-6 py-4 text-zinc-500">
                                                {new Date(user.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => openEditModal(user)}
                                                        className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(user.id, user.username)}
                                                        className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {users.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-12 text-center text-zinc-500">
                                                No users found.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Assignments Table */}
                {activeTab === "assignments" && (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-zinc-400 bg-zinc-900/50 uppercase border-b border-zinc-800">
                                    <tr>
                                        <th className="px-6 py-4 font-medium">Assignment</th>
                                        <th className="px-6 py-4 font-medium">Teacher</th>
                                        <th className="px-6 py-4 font-medium">Created</th>
                                        <th className="px-6 py-4 font-medium text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-800">
                                    {assignments.map((assignment) => (
                                        <tr key={assignment.id} className="hover:bg-zinc-800/50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0">
                                                        <FileText className="w-4 h-4 text-purple-400" />
                                                    </div>
                                                    <div className="font-medium text-white">{assignment.title || "Untitled"}</div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-zinc-300">{assignment.teacher_name}</td>
                                            <td className="px-6 py-4 text-zinc-500">{new Date(assignment.created_at).toLocaleDateString()}</td>
                                            <td className="px-6 py-4 text-right">
                                                <button onClick={() => handleDeleteAssignment(assignment.id, assignment.title)} className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {assignments.length === 0 && (
                                        <tr><td colSpan={4} className="px-6 py-12 text-center text-zinc-500">No assignments found.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Submissions Table */}
                {activeTab === "submissions" && (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-zinc-400 bg-zinc-900/50 uppercase border-b border-zinc-800">
                                    <tr>
                                        <th className="px-6 py-4 font-medium">Submission</th>
                                        <th className="px-6 py-4 font-medium">Student</th>
                                        <th className="px-6 py-4 font-medium">Integrity Score</th>
                                        <th className="px-6 py-4 font-medium">Submitted</th>
                                        <th className="px-6 py-4 font-medium text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-800">
                                    {submissions.map((sub) => (
                                        <tr key={sub.id} className="hover:bg-zinc-800/50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0">
                                                        <FileCheck className="w-4 h-4 text-blue-400" />
                                                    </div>
                                                    <div className="font-medium text-white">{sub.assignment_title || "Untitled"}</div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-zinc-300">@{sub.student_username}</td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${sub.integrity_score >= 80 ? 'bg-green-500/10 text-green-500' : sub.integrity_score >= 50 ? 'bg-yellow-500/10 text-yellow-500' : 'bg-red-500/10 text-red-500'}`}>
                                                    {sub.integrity_score}/100
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-zinc-500">{new Date(sub.submitted_at).toLocaleDateString()}</td>
                                            <td className="px-6 py-4 text-right">
                                                <button onClick={() => handleDeleteSubmission(sub.id, sub.assignment_title, sub.student_username)} className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {submissions.length === 0 && (
                                        <tr><td colSpan={5} className="px-6 py-12 text-center text-zinc-500">No submissions found.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Create / Edit Modal (Reused form layout) */}
            {(isCreateOpen || isEditOpen) && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                        <h2 className="text-xl font-semibold mb-6">
                            {isEditOpen ? `Edit ${selectedUser?.username}` : "Create New User"}
                        </h2>

                        <form onSubmit={isEditOpen ? handleEdit : handleCreate} className="space-y-4">
                            {!isEditOpen && (
                                <div>
                                    <label className="block text-xs font-medium text-zinc-400 mb-1">Username</label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.username}
                                        onChange={e => setFormData({ ...formData, username: e.target.value })}
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all"
                                    />
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-medium text-zinc-400 mb-1">
                                    Password {isEditOpen && <span className="text-zinc-600">(leave blank to keep current)</span>}
                                </label>
                                <input
                                    type="password"
                                    required={!isEditOpen}
                                    value={formData.password}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-zinc-400 mb-1">Full Name</label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.full_name}
                                        onChange={e => setFormData({ ...formData, full_name: e.target.value })}
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-zinc-400 mb-1">Email</label>
                                    <input
                                        type="email"
                                        required
                                        value={formData.email}
                                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-zinc-400 mb-1">Role</label>
                                <select
                                    value={formData.role}
                                    onChange={e => setFormData({ ...formData, role: e.target.value })}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all appearance-none"
                                >
                                    <option value="student">Student</option>
                                    <option value="teacher">Teacher</option>
                                    <option value="admin">System Admin</option>
                                </select>
                            </div>

                            {formData.role === "student" && !isEditOpen && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-zinc-400 mb-1">Class</label>
                                        <input
                                            type="text"
                                            value={formData.student_class}
                                            onChange={e => setFormData({ ...formData, student_class: e.target.value })}
                                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-zinc-600"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-zinc-400 mb-1">Course</label>
                                        <input
                                            type="text"
                                            value={formData.course}
                                            onChange={e => setFormData({ ...formData, course: e.target.value })}
                                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-zinc-600"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800 mt-6">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsCreateOpen(false)
                                        setIsEditOpen(false)
                                    }}
                                    className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="bg-white text-black px-6 py-2 rounded-xl text-sm font-medium hover:bg-zinc-200 transition-colors"
                                >
                                    {isEditOpen ? "Save Changes" : "Create User"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

        </div>
    )
}
