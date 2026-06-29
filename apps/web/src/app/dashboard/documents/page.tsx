import { cookies } from "next/headers";
import Link from "next/link";
import DocumentsDashboardClient from "./DocumentsDashboardClient";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

async function fetchDocuments(token: string) {
  try {
    const res = await fetch(`${apiUrl}/documents`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error("Failed to load documents:", err);
    return [];
  }
}

export const metadata = {
  title: "Documents — AI Study Assistant",
  description: "Manage your documents, files, and web links.",
};

export default async function DocumentsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  if (!token) {
    return (
      <main style={{ padding: "80px 20px", textAlign: "center" }}>
        <p style={{ color: "var(--color-text-muted)" }}>Please log in to manage your documents.</p>
        <Link href="/" style={{ color: "var(--color-primary)" }}>Go home</Link>
      </main>
    );
  }

  const documents = await fetchDocuments(token);

  return <DocumentsDashboardClient initialDocuments={documents} token={token} />;
}
