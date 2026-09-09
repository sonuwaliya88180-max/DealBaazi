const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
const PORT = 3000;

/* =========================
   BASIC SETUP
========================= */

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.set("view engine", "ejs");

const uploadDir = path.join(__dirname, "public", "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/* =========================
   MULTER
========================= */

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },

  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const name =
      Date.now() +
      "-" +
      Math.round(Math.random() * 1e9) +
      ext;

    cb(null, name);
  }
});

const upload = multer({
  storage: storage,

  limits: {
    fileSize: 5 * 1024 * 1024
  },

  fileFilter: function (req, file, cb) {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG and WEBP images are allowed."));
    }
  }
});

const multiUpload = upload.fields([
  {
    name: "images",
    maxCount: 5
  },

  {
    name: "image",
    maxCount: 1
  }
]);

function getUploadedImages(req) {
  const modern = req.files?.images || [];
  const legacy = req.files?.image || [];

  return [...modern, ...legacy].slice(0, 5);
}

/* =========================
   DATABASE
========================= */

const db = new Database("dealbaazi.db");

db.pragma("journal_mode = WAL");

/* =========================
   TABLES
========================= */

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
    expiry_date TEXT,
    clicks INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 1
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT NOT NULL,
    approved INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

/* =========================
   COLUMN MIGRATION
========================= */

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();

  const exists = columns.some(col => col.name === column);

  if (!exists) {
    db.prepare(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
    ).run();
  }
}

addColumnIfMissing(
  "products",
  "category_id",
  "INTEGER"
);

addColumnIfMissing(
  "products",
  "description",
  "TEXT DEFAULT ''"
);

addColumnIfMissing(
  "products",
  "original_price",
  "REAL DEFAULT 0"
);

addColumnIfMissing(
  "products",
  "hot_deal",
  "INTEGER DEFAULT 0"
);

/* =========================
   DEFAULT CATEGORIES
========================= */

const categoryCount = db
  .prepare("SELECT COUNT(*) AS count FROM categories")
  .get();

if (categoryCount.count === 0) {
  const defaultCategories = [
    "Mobiles",
    "Electronics",
    "Fashion",
    "Home & Kitchen",
    "Beauty",
    "Grocery",
    "Trending"
  ];

  const insertCategory = db.prepare(`
    INSERT INTO categories (name, sort_order, active)
    VALUES (?, ?, 1)
  `);

  defaultCategories.forEach((name, index) => {
    insertCategory.run(name, index);
  });
}

/* =========================
   DEFAULT ADMIN
========================= */

const adminCount = db
  .prepare("SELECT COUNT(*) AS count FROM admin")
  .get();

if (adminCount.count === 0) {
  db.prepare(`
    INSERT INTO admin (username, password)
    VALUES (?, ?)
  `).run("admin", "admin123");
}

/* =========================
   HELPERS
========================= */

function getDiscountPercent(discount) {
  const match = String(discount || "").match(/[\d.]+/);

  if (!match) return 0;

  return Math.max(
    0,
    Math.min(100, Number(match[0]))
  );
}

function calculateDealScore(product, reviewCount, avgRating) {
  const discountPercent =
    getDiscountPercent(product.discount);

  const discountScore =
    Math.min(discountPercent, 40);

  const ratingScore =
    (Number(avgRating || product.rating || 0) / 5) * 30;

  const reviewScore =
    (Math.min(Number(reviewCount || 0), 20) / 20) * 20;

  let priceScore = 0;

  if (
    Number(product.original_price) > 0 &&
    Number(product.price) > 0
  ) {
    const saving =
      ((Number(product.original_price) - Number(product.price)) /
        Number(product.original_price)) *
      100;

    priceScore = Math.min(
      Math.max(saving / 10, 0),
      10
    );
  } else {
    priceScore = Math.min(
      discountPercent / 10,
      10
    );
  }

  return Math.round(
    Math.min(
      discountScore +
        ratingScore +
        reviewScore +
        priceScore,
      100
    )
  );
}

function getProductImages(productId, fallbackImage) {
  const images = db.prepare(`
    SELECT image_url
    FROM product_images
    WHERE product_id = ?
    ORDER BY sort_order ASC, id ASC
  `).all(productId);

  if (images.length > 0) {
    return images.map(img => img.image_url);
  }

  if (fallbackImage) {
    return [fallbackImage];
  }

  return [];
}

function getReviewStats(productId, productRating) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS count,
      AVG(rating) AS average
    FROM reviews
    WHERE product_id = ?
      AND approved = 1
  `).get(productId);

  return {
    count: Number(stats.count || 0),

    average:
      stats.average !== null
        ? Number(stats.average).toFixed(1)
        : Number(productRating || 0).toFixed(1)
  };
}

/* =========================
   LOGIN
========================= */

let loggedIn = false;

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {

  const products = db.prepare(`
    SELECT
      p.*,
      c.name AS category_name
    FROM products p
    LEFT JOIN categories c
      ON p.category_id = c.id
    WHERE p.visible = 1
      AND (
        p.expiry_date IS NULL
        OR p.expiry_date = ''
        OR p.expiry_date >= date('now')
      )
    ORDER BY p.created_at DESC
  `).all();

  const categories = db.prepare(`
    SELECT *
    FROM categories
    WHERE active = 1
    ORDER BY sort_order ASC, id ASC
  `).all();

  const topPicks = products.filter(
    product => product.featured
  );

  const hotDeals = products.filter(
    product => product.hot_deal
  );

  const topRated = [...products]
    .sort((a, b) => {
      return Number(b.rating || 0) -
        Number(a.rating || 0);
    })
    .slice(0, 10);

  res.render("index", {
    products,
    categories,
    selectedCategory: null,
    topPicks,
    hotDeals,
    topRated
  });
});

/* =========================
   CATEGORY
========================= */

app.get("/category/:id", (req, res) => {

  const categoryId = Number(req.params.id);

  const category = db.prepare(`
    SELECT *
    FROM categories
    WHERE id = ?
      AND active = 1
  `).get(categoryId);

  if (!category) {
    return res.redirect("/");
  }

  const products = db.prepare(`
    SELECT
      p.*,
      c.name AS category_name
    FROM products p
    LEFT JOIN categories c
      ON p.category_id = c.id
    WHERE p.visible = 1
      AND p.category_id = ?
      AND (
        p.expiry_date IS NULL
        OR p.expiry_date = ''
        OR p.expiry_date >= date('now')
      )
    ORDER BY p.created_at DESC
  `).all(categoryId);

  const categories = db.prepare(`
    SELECT *
    FROM categories
    WHERE active = 1
    ORDER BY sort_order ASC, id ASC
  `).all();

  res.render("index", {
    products,
    categories,
    selectedCategory: category,
    topPicks: [],
    hotDeals: [],
    topRated: []
  });
});

/* =========================
   PRODUCT DETAIL
========================= */

app.get("/product/:id", (req, res) => {

  const id = Number(req.params.id);

  const product = db.prepare(`
    SELECT
      p.*,
      c.name AS category_name
    FROM products p
    LEFT JOIN categories c
      ON p.category_id = c.id
    WHERE p.id = ?
  `).get(id);

  if (!product) {
    return res.status(404).send("Product not found");
  }

  const images = getProductImages(
    product.id,
    product.image_url
  );

  const reviews = db.prepare(`
    SELECT *
    FROM reviews
    WHERE product_id = ?
      AND approved = 1
    ORDER BY created_at DESC
  `).all(id);

  const reviewStats =
    getReviewStats(id, product.rating);

  const dealScore =
    calculateDealScore(
      product,
      reviewStats.count,
      reviewStats.average
    );

  res.render("product", {
    product,
    images,
    reviews,
    reviewCount: reviewStats.count,
    averageRating: reviewStats.average,
    dealScore
  });
});

/* =========================
   BUY NOW
========================= */

app.get("/buy/:id", (req, res) => {

  const id = Number(req.params.id);

  const product = db.prepare(`
    SELECT *
    FROM products
    WHERE id = ?
      AND visible = 1
  `).get(id);

  if (!product) {
    return res.redirect("/");
  }

  db.prepare(`
    UPDATE products
    SET clicks = clicks + 1
    WHERE id = ?
  `).run(id);

  res.redirect(product.affiliate_url);
});

/* =========================
   PUBLIC REVIEW
========================= */

app.post("/product/:id/review", (req, res) => {

  const productId = Number(req.params.id);

  const product = db.prepare(`
    SELECT id
    FROM products
    WHERE id = ?
  `).get(productId);

  if (!product) {
    return res.status(404).send("Product not found");
  }

  const name =
    String(req.body.name || "").trim();

  const comment =
    String(req.body.comment || "").trim();

  const rating =
    Number(req.body.rating);

  if (
    !name ||
    !comment ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  ) {
    return res.redirect(
      `/product/${productId}#reviews`
    );
  }

  db.prepare(`
    INSERT INTO reviews
    (
      product_id,
      name,
      rating,
      comment,
      approved
    )
    VALUES (?, ?, ?, ?, 1)
  `).run(
    productId,
    name,
    rating,
    comment
  );

  res.redirect(
    `/product/${productId}#reviews`
  );
});

/* =========================
   LOGIN PAGE
========================= */

app.get("/login", (req, res) => {
  res.render("login", {
    error: null
  });
});

app.post("/login", (req, res) => {

  const {
    username,
    password
  } = req.body;

  const admin = db.prepare(`
    SELECT *
    FROM admin
    WHERE username = ?
      AND password = ?
  `).get(username, password);

  if (!admin) {
    return res.render("login", {
      error: "Invalid username or password"
    });
  }

  loggedIn = true;

  res.redirect("/admin");
});

/* =========================
   ADMIN
========================= */

app.get("/admin", (req, res) => {

  if (!loggedIn) {
    return res.redirect("/login");
  }

  const products = db.prepare(`
    SELECT
      p.*,
      c.name AS category_name
    FROM products p
    LEFT JOIN categories c
      ON p.category_id = c.id
    ORDER BY p.created_at DESC
  `).all();

  const categories = db.prepare(`
    SELECT *
    FROM categories
    ORDER BY sort_order ASC, id ASC
  `).all();

  const reviews = db.prepare(`
    SELECT
      r.*,
      p.name AS product_name
    FROM reviews r
    LEFT JOIN products p
      ON r.product_id = p.id
    ORDER BY r.created_at DESC
  `).all();

  res.render("admin", {
    products,
    categories,
    reviews
  });
});

/* =========================
   ADD CATEGORY
========================= */

app.post("/admin/categories/add", (req, res) => {

  if (!loggedIn) {
    return res.redirect("/login");
  }

  const name =
    String(req.body.name || "").trim();

  const sortOrder =
    Number(req.body.sort_order || 0);

  const active =
    req.body.active ? 1 : 0;

  if (!name) {
    return res.redirect("/admin");
  }

  try {

    db.prepare(`
      INSERT INTO categories
      (
        name,
        sort_order,
        active
      )
      VALUES (?, ?, ?)
    `).run(
      name,
      sortOrder,
      active
    );

  } catch (error) {

    console.log(error.message);

  }

  res.redirect("/admin");
});

/* =========================
   EDIT CATEGORY
========================= */

app.post("/admin/categories/edit/:id", (req, res) => {

  if (!loggedIn) {
    return res.redirect("/login");
  }

  const id =
    Number(req.params.id);

  const name =
    String(req.body.name || "").trim();

  const sortOrder =
    Number(req.body.sort_order || 0);

  const active =
    req.body.active ? 1 : 0;

  if (!name) {
    return res.redirect("/admin");
  }

  try {

    db.prepare(`
      UPDATE categories
      SET
        name = ?,
        sort_order = ?,
        active = ?
      WHERE id = ?
    `).run(
      name,
      sortOrder,
      active,
      id
    );

  } catch (error) {

    console.log(error.message);

  }

  res.redirect("/admin");
});

/* =========================
   DELETE CATEGORY
========================= */

app.post("/admin/categories/delete/:id", (req, res) => {

  if (!loggedIn) {
    return res.redirect("/login");
  }

  const id =
    Number(req.params.id);

  db.prepare(`
    UPDATE products
    SET category_id = NULL
    WHERE category_id = ?
  `).run(id);

  db.prepare(`
    DELETE FROM categories
    WHERE id = ?
  `).run(id);

  res.redirect("/admin");
});

/* =========================
   ADD PRODUCT
========================= */

app.post(
  "/admin/add",
  multiUpload,
  (req, res) => {

    if (!loggedIn) {
      return res.redirect("/login");
    }

    const files =
      getUploadedImages(req);

    const name =
      String(req.body.name || "").trim();

    const price =
      Number(req.body.price || 0);

    const originalPrice =
      Number(req.body.original_price || 0);

    const discount =
      String(req.body.discount || "").trim();

    const rating =
      Number(req.body.rating || 0);

    const affiliateUrl =
      String(req.body.affiliate_url || "").trim();

    const categoryId =
      req.body.category_id
        ? Number(req.body.category_id)
        : null;

    const expiryDate =
      req.body.expiry_date || null;

    const description =
      String(req.body.description || "").trim();

    const featured =
      req.body.featured ? 1 : 0;

    const trending =
      req.body.trending ? 1 : 0;

    const hotDeal =
      req.body.hot_deal ? 1 : 0;

    const visible =
      req.body.visible ? 1 : 0;

    let imageUrl = "";

    if (files.length > 0) {
      imageUrl =
        "/uploads/" + files[0].filename;
    }

    const result = db.prepare(`
      INSERT INTO products
      (
        name,
        price,
        original_price,
        discount,
        rating,
        affiliate_url,
        image_url,
        description,
        featured,
        trending,
        hot_deal,
        visible,
        expiry_date,
        category_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      price,
      originalPrice,
      discount,
      rating,
      affiliateUrl,
      imageUrl,
      description,
      featured,
      trending,
      hotDeal,
      visible,
      expiryDate,
      categoryId
    );

    const productId =
      result.lastInsertRowid;

    const insertImage = db.prepare(`
      INSERT INTO product_images
      (
        product_id,
        image_url,
        sort_order
      )
      VALUES (?, ?, ?)
    `);

    files.forEach((file, index) => {

      insertImage.run(
        productId,
        "/uploads/" + file.filename,
        index + 1
      );

    });

    res.redirect("/admin");
  }
);

/* =========================
   EDIT PAGE
========================= */

app.get("/admin/edit/:id", (req, res) => {

  if (!loggedIn) {
    return res.redirect("/login");
  }

  const id =
    Number(req.params.id);

  const product =
    db.prepare(`
      SELECT *
      FROM products
      WHERE id = ?
    `).get(id);

  if (!product) {
    return res.redirect("/admin");
  }

  const categories =
    db.prepare(`
      SELECT *
      FROM categories
      ORDER BY sort_order ASC, id ASC
    `).all();

  const images =
    getProductImages(
      product.id,
      product.image_url
    );

  res.render("edit", {
    product,
    categories,
    images
  });
});

/* =========================
   EDIT PRODUCT
========================= */

app.post(
  "/admin/edit/:id",
  multiUpload,
  (req, res) => {

    if (!loggedIn) {
      return res.redirect("/login");
    }

    const id =
      Number(req.params.id);

    const product =
      db.prepare(`
        SELECT *
        FROM products
        WHERE id = ?
      `).get(id);

    if (!product) {
      return res.redirect("/admin");
    }

    const files =
      getUploadedImages(req);

    const name =
      String(req.body.name || "").trim();

    const price =
      Number(req.body.price || 0);

    const originalPrice =
      Number(req.body.original_price || 0);

    const discount =
      String(req.body.discount || "").trim();

    const rating =
      Number(req.body.rating || 0);

    const affiliateUrl =
      String(req.body.affiliate_url || "").trim();

    const categoryId =
      req.body.category_id
        ? Number(req.body.category_id)
        : null;

    const expiryDate =
      req.body.expiry_date || null;

    const description =
      String(req.body.description || "").trim();

    const featured =
      req.body.featured ? 1 : 0;

    const trending =
      req.body.trending ? 1 : 0;

    const hotDeal =
      req.body.hot_deal ? 1 : 0;

    const visible =
      req.body.visible ? 1 : 0;

    let imageUrl =
      product.image_url || "";

    if (files.length > 0) {
      imageUrl =
        "/uploads/" +
        files[0].filename;
    }

    db.prepare(`
      UPDATE products
      SET
        name = ?,
        price = ?,
        original_price = ?,
        discount = ?,
        rating = ?,
        affiliate_url = ?,
        image_url = ?,
        description = ?,
        featured = ?,
        trending = ?,
        hot_deal = ?,
        visible = ?,
        expiry_date = ?,
        category_id = ?
      WHERE id = ?
    `).run(
      name,
      price,
      originalPrice,
      discount,
      rating,
      affiliateUrl,
      imageUrl,
      description,
      featured,
      trending,
      hotDeal,
      visible,
      expiryDate,
      categoryId,
      id
    );

    /*
      Agar new images upload hui hain,
      to purani gallery replace hogi.
    */

    if (files.length > 0) {

      db.prepare(`
        DELETE FROM product_images
        WHERE product_id = ?
      `).run(id);

      const insertImage = db.prepare(`
        INSERT INTO product_images
        (
          product_id,
          image_url,
          sort_order
        )
        VALUES (?, ?, ?)
      `);

      files.forEach((file, index) => {

        insertImage.run(
          id,
          "/uploads/" + file.filename,
          index + 1
        );

      });
    }

    res.redirect("/admin");
  }
);

/* =========================
   DELETE PRODUCT
========================= */

app.post("/admin/delete/:id", (req, res) => {

  if (!loggedIn) {
    return res.redirect("/login");
  }

  const id =
    Number(req.params.id);

  db.prepare(`
    DELETE FROM product_images
    WHERE product_id = ?
  `).run(id);

  db.prepare(`
    DELETE FROM reviews
    WHERE product_id = ?
  `).run(id);

  db.prepare(`
    DELETE FROM products
    WHERE id = ?
  `).run(id);

  res.redirect("/admin");
});

/* =========================
   DELETE REVIEW
========================= */

app.post("/admin/reviews/delete/:id", (req, res) => {

  if (!loggedIn) {
    return res.redirect("/login");
  }

  const id =
    Number(req.params.id);

  db.prepare(`
    DELETE FROM reviews
    WHERE id = ?
  `).run(id);

  res.redirect("/admin");
});

/* =========================
   LOGOUT
========================= */

app.get("/logout", (req, res) => {

  loggedIn = false;

  res.redirect("/login");
});

/* =========================
   CHANGE PASSWORD
========================= */

app.get("/password", (req, res) => {

  if (!loggedIn) {
    return res.redirect("/login");
  }

  res.render("password", {
    error: null,
    success: null
  });
});

app.post("/password", (req, res) => {

  if (!loggedIn) {
    return res.redirect("/login");
  }

  const oldPassword =
    String(req.body.old_password || "");

  const newPassword =
    String(req.body.new_password || "");

  const confirmPassword =
    String(req.body.confirm_password || "");

  const admin =
    db.prepare(`
      SELECT *
      FROM admin
      LIMIT 1
    `).get();

  if (!admin || admin.password !== oldPassword) {

    return res.render("password", {
      error: "Old password is incorrect.",
      success: null
    });
  }

  if (
    !newPassword ||
    newPassword !== confirmPassword
  ) {

    return res.render("password", {
      error: "New passwords do not match.",
      success: null
    });
  }

  db.prepare(`
    UPDATE admin
    SET password = ?
    WHERE id = ?
  `).run(
    newPassword,
    admin.id
  );

  res.render("password", {
    error: null,
    success: "Password changed successfully."
  });
});

/* =========================
   ERROR HANDLER
========================= */

app.use((err, req, res, next) => {

  console.error(err);

  if (
    err instanceof multer.MulterError
  ) {

    return res.status(400).send(
      "Image upload error: " +
      err.message
    );
  }

  res.status(500).send(
    "Something went wrong."
  );
});

/* =========================
   SERVER
========================= */

app.listen(PORT, () => {

  console.log(
    `DealBaazi running at http://localhost:${PORT}`
  );

});