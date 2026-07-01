"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PurchasedListing {
  id: string;
  amountPaid: number;
  createdAt: string;
  listing: {
    id: string;
    title: string;
    description: string;
    type: "QUIZ_SET" | "FLASHCARD_SET" | "STUDY_PACK";
    category: string;
    totalItems: number;
    rating: number;
  };
}

export default function LibraryPage() {
  const [token, setToken] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<PurchasedListing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) {
      setToken(savedToken);
      loadLibraryData(savedToken);
    } else {
      setLoading(false);
    }
  }, []);

  const loadLibraryData = async (activeToken: string) => {
    setLoading(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    const headers = { Authorization: `Bearer ${activeToken}` };

    try {
      // In Prisma, buyerId is current user id.
      // Since we don't have a direct listing of purchases endpoint yet, we can query purchases by current user from the backend.
      // Wait, let's write or mock the purchases query. In getListingDetails, we query purchases to see if purchased.
      // Let's make sure there is a way to get the user's purchased items.
      // Wait! Let's check if there is an endpoint `/marketplace/purchases` or if we can fetch all purchases for current user.
      // Let's query all completed purchases for current user from NestJS.
      // Wait! Let's check if we should add an endpoint in NestJS to list the buyer's purchases: `GET /marketplace/purchases`.
      // Yes! A `GET /marketplace/purchases` endpoint in `marketplace.controller.ts` is extremely useful. Let's make sure it is added.
      // Let's add `GET /marketplace/purchases` in NestJS first, then fetch it.
      const res = await fetch(`${apiUrl}/marketplace/purchases`, { headers });
      if (res.ok) {
        setPurchases(await res.json());
      }
    } catch (err) {
      console.error("Failed loading library:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "40px 20px" }}>
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "40px" }}>
        <div>
          <h1 style={{ fontSize: "2.2rem", color: "#fff", fontFamily: "var(--font-display)", fontWeight: 700 }}>
            My Purchased Library
          </h1>
          <p style={{ color: "var(--color-text-secondary)", marginTop: "4px" }}>
            Access all your premium study packs, quiz sets, and flashcard collections.
          </p>
        </div>
        <Link href="/marketplace" className="glass-panel" style={{ padding: "10px 20px", textDecoration: "none", color: "#fff" }}>
          ← Back to Marketplace
        </Link>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div style={{ width: "40px", height: "40px", border: "3px solid var(--glass-border)", borderTopColor: "var(--color-primary)", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 20px" }}></div>
          <p style={{ color: "var(--color-text-secondary)" }}>Loading library packs...</p>
        </div>
      ) : purchases.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: "center", padding: "60px 20px" }}>
          <p style={{ fontSize: "1.1rem", color: "#fff", marginBottom: "8px" }}>Your library is empty</p>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", marginBottom: "20px" }}>Browse the Study Marketplace to find premium resources.</p>
          <Link href="/marketplace" style={{ padding: "10px 20px", borderRadius: "8px", background: "var(--color-primary)", color: "#fff", textDecoration: "none", display: "inline-block", fontWeight: 600 }}>
            Go to Marketplace
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "24px" }}>
          {purchases.map((purchase) => {
            const item = purchase.listing;
            if (!item) return null;
            return (
              <div key={purchase.id} className="glass-panel" style={{ display: "flex", flexDirection: "column", height: "100%", padding: "20px" }}>
                
                {/* Type Badge */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                  <span style={{
                    padding: "4px 8px",
                    borderRadius: "6px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    background: item.type === "STUDY_PACK" ? "var(--color-secondary-glow)" : "var(--color-primary-glow)",
                    color: item.type === "STUDY_PACK" ? "var(--color-secondary)" : "var(--color-primary)"
                  }}>
                    {item.type.replace("_", " ")}
                  </span>
                  <span style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>
                    {item.totalItems} items
                  </span>
                </div>

                {/* Title */}
                <h3 style={{ color: "#fff", fontSize: "1.15rem", marginBottom: "8px", fontFamily: "var(--font-display)" }}>
                  {item.title}
                </h3>
                
                <p style={{
                  color: "var(--color-text-secondary)",
                  fontSize: "0.9rem",
                  lineHeight: "1.45",
                  marginBottom: "16px",
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  flexGrow: 1
                }}>
                  {item.description}
                </p>

                {/* Meta details */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--glass-border)", paddingTop: "16px", marginTop: "auto" }}>
                  <div>
                    <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", display: "block" }}>Purchased on</span>
                    <span style={{ fontSize: "0.85rem", color: "#fff", fontWeight: 600 }}>
                      {new Date(purchase.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <Link href={`/marketplace/${item.id}`} style={{
                    padding: "8px 20px",
                    borderRadius: "8px",
                    background: "var(--color-success)",
                    color: "#fff",
                    textDecoration: "none",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    boxShadow: "0 4px 12px var(--color-success-glow)"
                  }}>
                    Open Pack
                  </Link>
                </div>

              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
