"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Listing {
  id: string;
  title: string;
  description: string;
  type: "QUIZ_SET" | "FLASHCARD_SET" | "STUDY_PACK";
  price: number; // in cents
  category: string;
  tags: string[];
  rating: number;
  salesCount: number;
  totalItems: number;
  createdAt: string;
}

export default function MarketplacePage() {
  const [token, setToken] = useState<string | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filter states
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [priceMax, setPriceMax] = useState<number>(5000); // default $50 max (in cents)
  const [minRating, setMinRating] = useState<number>(0);

  // Pagination states
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Debounce search effect (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Read auth token
  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) {
      setToken(savedToken);
    }
  }, []);

  // Fetch listings on filter change
  useEffect(() => {
    loadListings(true);
  }, [debouncedSearch, selectedType, selectedCategory, priceMax, minRating, token]);

  const loadListings = async (reset = false) => {
    setLoading(true);
    setError("");
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    try {
      let url = "";
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      if (debouncedSearch.trim()) {
        // Use vector search route
        url = `${apiUrl}/marketplace/search?q=${encodeURIComponent(debouncedSearch)}`;
      } else {
        // Use standard paginated listings route
        const params = new URLSearchParams();
        if (selectedType !== "ALL") params.append("type", selectedType);
        if (selectedCategory.trim()) params.append("category", selectedCategory);
        if (priceMax < 10000) params.append("priceMax", priceMax.toString());
        if (minRating > 0) params.append("ratingMin", minRating.toString());
        if (!reset && cursor) params.append("cursor", cursor);
        params.append("limit", "9");

        url = `${apiUrl}/marketplace?${params.toString()}`;
      }

      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error("Failed to load listings");
      }

      const data = await res.json();
      if (debouncedSearch.trim()) {
        // Search API returns array directly
        setListings(data);
        setHasMore(false);
        setNextCursor(null);
      } else {
        // Paginated API returns { items, nextCursor, hasMore }
        if (reset) {
          setListings(data.items || []);
        } else {
          setListings((prev) => [...prev, ...(data.items || [])]);
        }
        setNextCursor(data.nextCursor);
        setHasMore(data.hasMore || false);
      }
    } catch (err: any) {
      setError(err.message || "Error fetching listings");
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = () => {
    if (nextCursor) {
      setCursor(nextCursor);
      // Wait for state to apply
      setTimeout(() => loadListings(false), 50);
    }
  };

  const resetFilters = () => {
    setSearch("");
    setSelectedType("ALL");
    setSelectedCategory("");
    setPriceMax(5000);
    setMinRating(0);
    setCursor(null);
  };

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "40px 20px", position: "relative" }}>
      <div className="bg-glow-1"></div>
      <div className="bg-glow-2"></div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "40px" }}>
        <div>
          <h1 style={{ fontSize: "2.5rem", color: "#fff", fontFamily: "var(--font-display)", fontWeight: 700 }}>
            Study Marketplace
          </h1>
          <p style={{ color: "var(--color-text-secondary)", marginTop: "6px" }}>
            Unlock premium flashcard decks, high-yield quiz sets, and complete study packs built by top creators.
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <Link href="/dashboard/library" className="glass-panel" style={{ padding: "10px 20px", textDecoration: "none", color: "#fff", display: "flex", alignItems: "center", gap: "8px" }}>
            📚 My Library
          </Link>
          <Link href="/dashboard/creator" className="glass-panel" style={{ padding: "10px 20px", textDecoration: "none", color: "var(--color-primary)", display: "flex", alignItems: "center", gap: "8px", borderColor: "rgba(99, 102, 241, 0.3)" }}>
            ⚡ Creator Studio
          </Link>
        </div>
      </div>

      {/* Main Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "30px", alignItems: "start" }}>
        
        {/* Sidebar Filters */}
        <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ color: "#fff", fontSize: "1.1rem" }}>Filters</h3>
            <button onClick={resetFilters} style={{ background: "none", border: "none", color: "var(--color-primary)", cursor: "pointer", fontSize: "0.85rem" }}>
              Clear All
            </button>
          </div>

          {/* Type Filter */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Content Type</label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              style={{
                padding: "10px",
                background: "var(--bg-primary)",
                border: "1px solid var(--glass-border)",
                borderRadius: "8px",
                color: "#fff",
                outline: "none"
              }}
            >
              <option value="ALL">All Formats</option>
              <option value="QUIZ_SET">Quiz Sets</option>
              <option value="FLASHCARD_SET">Flashcard Decks</option>
              <option value="STUDY_PACK">Study Packs</option>
            </select>
          </div>

          {/* Category Filter */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Category</label>
            <input
              type="text"
              placeholder="e.g. Biology, Calculus"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              style={{
                padding: "10px 14px",
                background: "var(--bg-primary)",
                border: "1px solid var(--glass-border)",
                borderRadius: "8px",
                color: "#fff",
                outline: "none"
              }}
            />
          </div>

          {/* Price Slider */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
              <span style={{ color: "var(--color-text-secondary)" }}>Max Price</span>
              <span style={{ color: "#fff", fontWeight: 600 }}>${(priceMax / 100).toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="10000"
              step="500"
              value={priceMax}
              onChange={(e) => setPriceMax(parseInt(e.target.value, 10))}
              style={{
                width: "100%",
                accentColor: "var(--color-primary)"
              }}
            />
          </div>

          {/* Rating Filter */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Min Rating</label>
            <div style={{ display: "flex", gap: "6px" }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setMinRating(minRating === star ? 0 : star)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "1.4rem",
                    color: star <= minRating ? "#f59e0b" : "var(--color-text-muted)",
                    transition: "color 0.2s"
                  }}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Directory Listings Grid */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          
          {/* Search Box */}
          <div className="glass-panel" style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ color: "var(--color-text-secondary)", fontSize: "1.2rem" }}>🔍</span>
            <input
              type="text"
              placeholder="Search study resources semantically (e.g. 'high yield MCAT biochemistry card decks')..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                background: "none",
                border: "none",
                color: "#fff",
                outline: "none",
                fontSize: "1rem"
              }}
            />
            {search && (
              <button onClick={() => setSearch("")} style={{ background: "none", border: "none", color: "var(--color-text-secondary)", cursor: "pointer" }}>
                ✕
              </button>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="glass-panel" style={{ borderColor: "var(--color-error)", color: "var(--color-error)", padding: "16px" }}>
              ⚠️ {error}
            </div>
          )}

          {/* Listings Container */}
          {loading && listings.length === 0 ? (
            <div style={{ textAlign: "center", padding: "80px 0" }}>
              <div style={{ width: "40px", height: "40px", border: "3px solid var(--glass-border)", borderTopColor: "var(--color-primary)", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 20px" }}></div>
              <p style={{ color: "var(--color-text-secondary)" }}>Searching marketplace archives...</p>
            </div>
          ) : listings.length === 0 ? (
            <div className="glass-panel" style={{ textAlign: "center", padding: "60px 20px" }}>
              <p style={{ fontSize: "1.1rem", color: "#fff", marginBottom: "8px" }}>No study sets found</p>
              <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem" }}>Try expanding your search query or adjusting your filters.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "24px" }}>
              {listings.map((item) => (
                <div key={item.id} className="glass-panel" style={{ display: "flex", flexDirection: "column", height: "100%", padding: "20px" }}>
                  
                  {/* Badge & Type */}
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
                      {item.totalItems} {item.type === "FLASHCARD_SET" ? "cards" : "questions"}
                    </span>
                  </div>

                  {/* Title & Info */}
                  <h3 style={{ color: "#fff", fontSize: "1.15rem", marginBottom: "8px", fontFamily: "var(--font-display)", fontWeight: 600 }}>
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

                  {/* Rating & Sales */}
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px", fontSize: "0.85rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ color: "#f59e0b" }}>★</span>
                      <span style={{ color: "#fff", fontWeight: 600 }}>{item.rating.toFixed(1)}</span>
                    </div>
                    <span style={{ color: "var(--color-text-muted)" }}>•</span>
                    <span style={{ color: "var(--color-text-secondary)" }}>{item.salesCount} sold</span>
                    <span style={{ color: "var(--color-text-muted)" }}>•</span>
                    <span style={{ color: "var(--color-text-secondary)" }}>{item.category}</span>
                  </div>

                  {/* Footer & CTA */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--glass-border)", paddingTop: "16px", marginTop: "auto" }}>
                    <div>
                      <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", display: "block" }}>Price</span>
                      <span style={{ fontSize: "1.25rem", color: "#fff", fontWeight: 700 }}>
                        {item.price === 0 ? "Free" : `$${(item.price / 100).toFixed(2)}`}
                      </span>
                    </div>
                    <Link href={`/marketplace/${item.id}`} style={{
                      padding: "8px 16px",
                      borderRadius: "8px",
                      background: "var(--color-primary)",
                      color: "#fff",
                      textDecoration: "none",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      boxShadow: "0 4px 12px var(--color-primary-glow)",
                      transition: "transform 0.2s"
                    }}>
                      View Pack
                    </Link>
                  </div>

                </div>
              ))}
            </div>
          )}

          {/* Load More */}
          {hasMore && !loading && (
            <button onClick={handleLoadMore} className="glass-panel" style={{ width: "100%", padding: "14px", color: "var(--color-primary)", background: "none", cursor: "pointer", fontWeight: 600 }}>
              Load More Results
            </button>
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
