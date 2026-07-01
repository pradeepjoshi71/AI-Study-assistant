"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  user: {
    name: string;
  };
}

interface ListingItem {
  id: string;
  itemId: string;
  itemType: "QUIZ" | "FLASHCARD";
  orderIndex: number;
}

interface ListingDetails {
  id: string;
  title: string;
  description: string;
  type: "QUIZ_SET" | "FLASHCARD_SET" | "STUDY_PACK";
  price: number;
  category: string;
  tags: string[];
  rating: number;
  salesCount: number;
  totalItems: number;
  previewItemCount: number;
  creator: {
    id: string;
    name: string;
    email: string;
  };
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ListingDetailsPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);

  const [token, setToken] = useState<string | null>(null);
  const [listing, setListing] = useState<ListingDetails | null>(null);
  const [hasPurchased, setHasPurchased] = useState(false);
  const [items, setItems] = useState<ListingItem[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsMeta, setReviewsMeta] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [userPlan, setUserPlan] = useState<string>("FREE");
  const [buying, setBuying] = useState(false);
  const [purchasingError, setPurchasingError] = useState("");

  // Review form states
  const [newRating, setNewRating] = useState(5);
  const [newComment, setNewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState("");

  // Accordion active state
  const [activeAccordion, setActiveAccordion] = useState<string | null>(null);

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) {
      setToken(savedToken);
    }
    loadData(savedToken);
  }, [id]);

  const loadData = async (activeToken: string | null) => {
    setLoading(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    try {
      const headers: Record<string, string> = {};
      if (activeToken) {
        headers["Authorization"] = `Bearer ${activeToken}`;
      }

      // 1. Fetch listing details (items + paginated reviews)
      const res = await fetch(`${apiUrl}/marketplace/listings/${id}`, { headers });
      if (!res.ok) throw new Error("Listing not found");

      const data = await res.json();
      setListing(data.listing);
      setHasPurchased(data.hasPurchased);
      setItems(data.items || []);
      setReviews(data.reviews?.data || []);
      setReviewsMeta(data.reviews?.meta || {});

      // 2. Fetch user plan from billing summary
      if (activeToken) {
        const billingRes = await fetch(`${apiUrl}/billing/summary`, { headers });
        if (billingRes.ok) {
          const billingData = await billingRes.json();
          setUserPlan(billingData.plan?.type || "FREE");
        }
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async () => {
    if (userPlan === "FREE") return; // Gated by UI, but double safeguard
    setBuying(true);
    setPurchasingError("");
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    try {
      const res = await fetch(`${apiUrl}/marketplace/listings/${id}/purchase`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Failed to initiate purchase");
      }

      const { clientSecret, paymentIntentId } = await res.json();

      // Simulate webhook payment confirmation to lock/unlock and show details
      // In production, Stripe elements SDK processes payment and Stripe webhook triggers success
      alert(`Stripe Checkout simulated successfully!\nPayment Intent: ${paymentIntentId}\nClient Secret: ${clientSecret?.substring(0, 15)}...`);

      // Mock confirmation triggers direct reload
      setTimeout(async () => {
        await loadData(token);
        setBuying(false);
      }, 1500);

    } catch (err: any) {
      setPurchasingError(err.message || "Checkout failed");
      setBuying(false);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingReview(true);
    setReviewError("");
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    try {
      const res = await fetch(`${apiUrl}/marketplace/listings/${id}/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          rating: newRating,
          comment: newComment.trim() || undefined
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Failed to submit review");
      }

      setNewComment("");
      await loadData(token);
    } catch (err: any) {
      setReviewError(err.message || "Failed to submit review");
    } finally {
      setSubmittingReview(false);
    }
  };

  if (loading && !listing) {
    return (
      <div style={{ textAlign: "center", padding: "120px 0" }}>
        <div style={{ width: "40px", height: "40px", border: "3px solid var(--glass-border)", borderTopColor: "var(--color-primary)", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 20px" }}></div>
        <p style={{ color: "var(--color-text-secondary)" }}>Loading pack details...</p>
      </div>
    );
  }

  if (!listing) {
    return (
      <div style={{ maxWidth: "800px", margin: "80px auto", textAlign: "center" }} className="glass-panel">
        <h2 style={{ color: "var(--color-error)", marginBottom: "12px" }}>Listing Not Found</h2>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: "20px" }}>The listing you are looking for does not exist or was deleted.</p>
        <Link href="/marketplace" style={{ color: "var(--color-primary)", textDecoration: "none" }}>← Back to Marketplace</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "40px 20px", position: "relative" }}>
      <div className="bg-glow-1"></div>
      <div className="bg-glow-2"></div>

      <div style={{ marginBottom: "24px" }}>
        <Link href="/marketplace" style={{ color: "var(--color-text-secondary)", textDecoration: "none", fontSize: "0.9rem" }}>
          ← Back to Marketplace
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "40px", alignItems: "start" }}>
        
        {/* Left Column: Info, Items, Reviews */}
        <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>
          
          {/* Main Info */}
          <div className="glass-panel" style={{ padding: "30px" }}>
            <span style={{
              padding: "4px 8px",
              borderRadius: "6px",
              fontSize: "0.75rem",
              fontWeight: 600,
              background: "var(--color-primary-glow)",
              color: "var(--color-primary)",
              display: "inline-block",
              marginBottom: "16px"
            }}>
              {listing.type.replace("_", " ")}
            </span>
            <h1 style={{ fontSize: "2.2rem", color: "#fff", marginBottom: "12px", fontFamily: "var(--font-display)", fontWeight: 700 }}>
              {listing.title}
            </h1>
            
            <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "24px", fontSize: "0.9rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ color: "#f59e0b", fontSize: "1.1rem" }}>★</span>
                <span style={{ color: "#fff", fontWeight: 600 }}>{listing.rating.toFixed(1)}</span>
              </div>
              <span style={{ color: "var(--color-text-muted)" }}>•</span>
              <span style={{ color: "var(--color-text-secondary)" }}>{listing.salesCount} purchases</span>
              <span style={{ color: "var(--color-text-muted)" }}>•</span>
              <span style={{ color: "var(--color-text-secondary)" }}>Category: {listing.category}</span>
            </div>

            <h3 style={{ color: "#fff", fontSize: "1.1rem", marginBottom: "10px" }}>Description</h3>
            <p style={{ color: "var(--color-text-secondary)", lineHeight: "1.6", fontSize: "0.95rem" }}>
              {listing.description}
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "20px" }}>
              {listing.tags.map((tag) => (
                <span key={tag} style={{ padding: "4px 10px", background: "var(--bg-primary)", border: "1px solid var(--glass-border)", borderRadius: "6px", fontSize: "0.8rem", color: "var(--color-text-secondary)" }}>
                  #{tag}
                </span>
              ))}
            </div>
          </div>

          {/* Accordion List of Items */}
          <div className="glass-panel" style={{ padding: "30px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ color: "#fff", fontSize: "1.25rem" }}>Content items</h3>
              <span style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>
                {hasPurchased ? "All unlocked" : `Previewing ${listing.previewItemCount} of ${listing.totalItems}`}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {items.map((item, idx) => (
                <div key={item.id} style={{ border: "1px solid var(--glass-border)", borderRadius: "8px", background: "var(--bg-primary)", overflow: "hidden" }}>
                  <button
                    onClick={() => setActiveAccordion(activeAccordion === item.id ? null : item.id)}
                    style={{
                      width: "100%",
                      padding: "16px",
                      background: "none",
                      border: "none",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      cursor: "pointer",
                      color: "#fff",
                      fontSize: "0.95rem",
                      fontWeight: 500
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem" }}>#{idx + 1}</span>
                      <span style={{
                        padding: "2px 6px",
                        borderRadius: "4px",
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        background: item.itemType === "QUIZ" ? "var(--color-secondary-glow)" : "var(--color-primary-glow)",
                        color: item.itemType === "QUIZ" ? "var(--color-secondary)" : "var(--color-primary)"
                      }}>
                        {item.itemType}
                      </span>
                      <span>Item ID: {item.itemId.substring(0, 8)}...</span>
                    </div>
                    <span>{activeAccordion === item.id ? "▲" : "▼"}</span>
                  </button>

                  {activeAccordion === item.id && (
                    <div style={{ padding: "16px", borderTop: "1px solid var(--glass-border)", color: "var(--color-text-secondary)", fontSize: "0.9rem", lineHeight: "1.5" }}>
                      <p style={{ marginBottom: "8px" }}>This item is fully accessible within your workspace.</p>
                      <p style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Type: {item.itemType} | order index: {item.orderIndex}</p>
                    </div>
                  )}
                </div>
              ))}

              {!hasPurchased && listing.totalItems > listing.previewItemCount && (
                <div className="glass-panel" style={{ textAlign: "center", padding: "20px", marginTop: "10px", borderColor: "rgba(99, 102, 241, 0.2)" }}>
                  🔒 Purchase this Study Pack to unlock the remaining {listing.totalItems - listing.previewItemCount} items.
                </div>
              )}
            </div>
          </div>

          {/* Reviews List & Form */}
          <div className="glass-panel" style={{ padding: "30px" }}>
            <h3 style={{ color: "#fff", fontSize: "1.25rem", marginBottom: "20px" }}>Reviews ({reviewsMeta.total || 0})</h3>

            {/* Review Input (only for buyers) */}
            {hasPurchased ? (
              <form onSubmit={handleSubmitReview} style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "30px", paddingBottom: "24px", borderBottom: "1px solid var(--glass-border)" }}>
                <h4 style={{ color: "#fff", fontSize: "0.95rem" }}>Write a review</h4>
                
                {reviewError && <div style={{ color: "var(--color-error)", fontSize: "0.85rem" }}>{reviewError}</div>}

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Rating:</span>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      type="button"
                      key={star}
                      onClick={() => setNewRating(star)}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "1.25rem",
                        color: star <= newRating ? "#f59e0b" : "var(--color-text-muted)"
                      }}
                    >
                      ★
                    </button>
                  ))}
                </div>

                <textarea
                  placeholder="Share your experience using this study pack (optional)..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  style={{
                    width: "100%",
                    minHeight: "80px",
                    padding: "10px 14px",
                    background: "var(--bg-primary)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: "8px",
                    color: "#fff",
                    outline: "none",
                    fontFamily: "inherit",
                    fontSize: "0.9rem"
                  }}
                />

                <button
                  type="submit"
                  disabled={submittingReview}
                  style={{
                    alignSelf: "flex-end",
                    padding: "8px 20px",
                    borderRadius: "8px",
                    background: "var(--color-primary)",
                    color: "#fff",
                    border: "none",
                    fontWeight: 600,
                    cursor: "pointer",
                    opacity: submittingReview ? 0.7 : 1
                  }}
                >
                  {submittingReview ? "Submitting..." : "Submit Review"}
                </button>
              </form>
            ) : null}

            {/* List */}
            {reviews.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)", fontSize: "0.9rem" }}>No reviews written yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                {reviews.map((rev) => (
                  <div key={rev.id} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#fff", fontWeight: 600, fontSize: "0.9rem" }}>{rev.user?.name || "Verified Student"}</span>
                      <span style={{ color: "var(--color-text-muted)", fontSize: "0.8rem" }}>{new Date(rev.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div style={{ display: "flex", gap: "2px", color: "#f59e0b", fontSize: "0.85rem" }}>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <span key={i}>{i < rev.rating ? "★" : "☆"}</span>
                      ))}
                    </div>
                    {rev.comment && (
                      <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", lineHeight: "1.4", marginTop: "4px" }}>
                        {rev.comment}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Right Column: Checkout Widget */}
        <div className="glass-panel" style={{ padding: "30px", position: "sticky", top: "40px", display: "flex", flexDirection: "column", gap: "24px" }}>
          <div>
            <span style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Creator</span>
            <span style={{ color: "#fff", fontWeight: 600, display: "block", fontSize: "1.1rem", marginTop: "2px" }}>
              {listing.creator.name}
            </span>
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{listing.creator.email}</span>
          </div>

          <hr style={{ border: "none", borderTop: "1px solid var(--glass-border)" }} />

          <div>
            <span style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Pack Price</span>
            <span style={{ fontSize: "2.25rem", color: "#fff", fontWeight: 800, display: "block", marginTop: "4px" }}>
              {listing.price === 0 ? "Free" : `$${(listing.price / 100).toFixed(2)}`}
            </span>
          </div>

          {/* Action Widget */}
          {hasPurchased ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ background: "var(--color-success-glow)", border: "1px solid var(--color-success)", color: "#fff", borderRadius: "10px", padding: "12px", textAlign: "center", fontSize: "0.9rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                <span>✓</span> You own this Study Pack
              </div>
              <Link href="/dashboard/library" style={{
                width: "100%",
                padding: "12px",
                borderRadius: "10px",
                background: "var(--color-primary)",
                color: "#fff",
                border: "none",
                fontWeight: 600,
                cursor: "pointer",
                textAlign: "center",
                textDecoration: "none",
                fontSize: "0.95rem"
              }}>
                Open in Library
              </Link>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {userPlan === "FREE" ? (
                // Disabled + Upgrade Prompt for Free tier
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <button
                    disabled
                    style={{
                      width: "100%",
                      padding: "14px",
                      borderRadius: "10px",
                      background: "var(--color-text-muted)",
                      color: "rgba(255, 255, 255, 0.4)",
                      border: "none",
                      fontWeight: 600,
                      cursor: "not-allowed",
                      fontSize: "0.95rem"
                    }}
                  >
                    Buy Pack (Locked)
                  </button>
                  <div style={{ background: "var(--color-primary-glow)", border: "1px solid rgba(99, 102, 241, 0.3)", borderRadius: "10px", padding: "16px", fontSize: "0.85rem", lineHeight: "1.45" }}>
                    ⭐ <strong style={{ color: "#fff" }}>Upgrade to Pro+ Plan</strong> to purchase premium marketplace packages. Free tier users are locked out from marketplace checkouts.
                    <Link href="/dashboard/billing" style={{ display: "block", marginTop: "10px", color: "var(--color-primary)", textDecoration: "none", fontWeight: 600 }}>
                      Upgrade Account →
                    </Link>
                  </div>
                </div>
              ) : (
                // Active purchase button for Pro+ users
                <div>
                  {purchasingError && (
                    <div style={{ color: "var(--color-error)", fontSize: "0.85rem", marginBottom: "10px" }}>
                      {purchasingError}
                    </div>
                  )}
                  <button
                    onClick={handlePurchase}
                    disabled={buying}
                    style={{
                      width: "100%",
                      padding: "14px",
                      borderRadius: "10px",
                      background: "var(--color-primary)",
                      color: "#fff",
                      border: "none",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontSize: "0.95rem",
                      boxShadow: "0 6px 18px var(--color-primary-glow)",
                      opacity: buying ? 0.7 : 1
                    }}
                  >
                    {buying ? "Initiating Checkout..." : "Buy Study Pack"}
                  </button>
                </div>
              )}
            </div>
          )}

        </div>

      </div>

      <style jsx global>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
