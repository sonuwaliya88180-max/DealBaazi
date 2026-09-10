const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
const PORT = 3000;

// Database
const db = new Database("dealbaazi.db");

db.prepare(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL DEFAULT 0,
    discount TEXT DEFAULT '',
    rating REAL DEFAULT 0,
    affiliate_url TEXT NOT NULL,
    image_url TEXT DEFAULT '',
    featured INTEGER DEFAULT 0,
    trending INTEGER DEFAULT 0,
    visible INTEGER DEFAULT 1,
    expiry_date TEXT DEFAULT NULL,
    clicks INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Home
app.get("/", (req, res) => {
  const products = db.prepare(`
    SELECT * FROM products
    WHERE visible = 1
    AND (expiry_date IS NULL OR expiry_date = '' OR expiry_date >= date('now'))
    ORDER BY featured DESC, trending DESC, id DESC
  `).all();

  res.render("index", { products });
});

// Direct affiliate click
app.get("/buy/:id", (req, res) => {
  const product = db.prepare(
    "SELECT * FROM products WHERE id = ? AND visible = 1"
  ).get(req.params.id);

  if (!product) {
    return res.status(404).send("Product not found");
  }

  db.prepare(
    "UPDATE products SET clicks = clicks + 1 WHERE id = ?"
  ).run(req.params.id);

  // Click count ke turant baad affiliate URL open
  res.redirect(product.affiliate_url);
});

// Admin
app.get("/admin", (req, res) => {
  const products = db.prepare(
    "SELECT * FROM products ORDER BY id DESC"
  ).all();

  res.render("admin", { products });
});

// Add product
app.post("/admin/add", (req, res) => {
  const {
    name,
    price,
    discount,
    rating,
    affiliate_url,
    image_url,
    featured,
    trending,
    visible,
    expiry_date
  } = req.body;

  db.prepare(`
    INSERT INTO products
    (name, price, discount, rating, affiliate_url, image_url,
     featured, trending, visible, expiry_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    price || 0,
    discount || "",
    rating || 0,
    affiliate_url,
    image_url || "",
    featured ? 1 : 0,
    trending ? 1 : 0,
    visible ? 1 : 0,
    expiry_date || null
  );

  res.redirect("/admin");
});

// Delete product
app.post("/admin/delete/:id", (req, res) => {
  db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  res.redirect("/admin");
});

// Server
app.listen(PORT, () => {
  console.log(`DealBaazi running at http://localhost:${PORT}`);
});