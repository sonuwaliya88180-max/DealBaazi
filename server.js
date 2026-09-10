const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const app = express();

/* =========================================================
   SERVER SETTINGS
========================================================= */

const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================================================
   STORAGE PATHS
========================================================= */

/*
   Local PC:
   dealbaazi.db
   public/uploads

   Render / future hosting:
   DB_PATH and UPLOADS_DIR can be supplied
   through environment variables.
*/

const dbPath =
  process.env.DB_PATH ||
  path.join(
    __dirname,
    "dealbaazi.db"
  );

const uploadsDir =
  process.env.UPLOADS_DIR ||
  path.join(
    __dirname,
    "public",
    "uploads"
  );

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(
    uploadsDir,
    {
      recursive: true
    }
  );
}

/* =========================================================
   MULTER UPLOAD
========================================================= */

const storage =
  multer.diskStorage({
    destination:
      function (
        req,
        file,
        cb
      ) {
        cb(
          null,
          uploadsDir
        );
      },

    filename:
      function (
        req,
        file,
        cb
      ) {
        const ext =
          path.extname(
            file.originalname
          );

        const name =
          Date.now() +
          "-" +
          Math.round(
            Math.random() *
              1e9
          ) +
          ext;

        cb(
          null,
          name
        );
      }
  });

const upload =
  multer({
    storage,

    limits: {
      fileSize:
        5 * 1024 * 1024
    },

    fileFilter:
      function (
        req,
        file,
        cb
      ) {
        const allowed = [
          "image/jpeg",
          "image/png",
          "image/webp"
        ];

        if (
          allowed.includes(
            file.mimetype
          )
        ) {
          cb(
            null,
            true
          );
        } else {
          cb(
            new Error(
              "Only JPG, PNG and WEBP images are allowed."
            )
          );
        }
      }
  });

const multiUpload =
  upload.fields([
    {
      name: "images",
      maxCount: 5
    },
    {
      name: "image",
      maxCount: 1
    }
  ]);

const homepageUpload =
  upload.fields([
    {
      name: "logo",
      maxCount: 1
    },
    {
      name: "hero_image",
      maxCount: 1
    }
  ]);

/* =========================================================
   DATABASE
========================================================= */

const db =
  new Database(
    dbPath
  );

db.pragma(
  "journal_mode = WAL"
);

/* =========================================================
   DATABASE TABLES
========================================================= */

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL DEFAULT 0,
    discount TEXT DEFAULT '',
    rating REAL DEFAULT 0,
    affiliate_url TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    featured INTEGER DEFAULT 0,
    trending INTEGER DEFAULT 0,
    visible INTEGER DEFAULT 1,
    expiry_date TEXT DEFAULT '',
    clicks INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    password TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    name TEXT DEFAULT '',
    rating REAL DEFAULT 5,
    comment TEXT DEFAULT '',
    approved INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

/* =========================================================
   EXISTING MIGRATIONS
========================================================= */

try {
  db.prepare(`
    ALTER TABLE products
    ADD COLUMN category_id INTEGER DEFAULT NULL
  `).run();
} catch (e) {}

try {
  db.prepare(`
    ALTER TABLE products
    ADD COLUMN description TEXT DEFAULT ''
  `).run();
} catch (e) {}

try {
  db.prepare(`
    ALTER TABLE products
    ADD COLUMN original_price REAL DEFAULT 0
  `).run();
} catch (e) {}

try {
  db.prepare(`
    ALTER TABLE products
    ADD COLUMN hot_deal INTEGER DEFAULT 0
  `).run();
} catch (e) {}

/* =========================================================
   HOMEPAGE CMS TABLES
========================================================= */

db.exec(`
  CREATE TABLE IF NOT EXISTS site_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT NOT NULL UNIQUE,
    setting_value TEXT DEFAULT ''
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_url TEXT DEFAULT '',
    heading TEXT DEFAULT '',
    description TEXT DEFAULT '',
    button_text TEXT DEFAULT '',
    link_url TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

/* =========================================================
   DEFAULT CATEGORIES
========================================================= */

const categoryCount =
  db.prepare(`
    SELECT COUNT(*) AS count
    FROM categories
  `).get();

if (
  categoryCount.count === 0
) {
  const insertCategory =
    db.prepare(`
      INSERT INTO categories
      (
        name,
        sort_order,
        active
      )
      VALUES (?, ?, 1)
    `);

  const defaultCategories = [
    "Mobiles",
    "Electronics",
    "Fashion",
    "Home & Kitchen",
    "Beauty",
    "Grocery",
    "Trending"
  ];

  defaultCategories.forEach(
    (
      name,
      index
    ) => {
      insertCategory.run(
        name,
        index + 1
      );
    }
  );
}

/* =========================================================
   DEFAULT ADMIN
========================================================= */

const adminCount =
  db.prepare(`
    SELECT COUNT(*) AS count
    FROM admin
  `).get();

if (
  adminCount.count === 0
) {
  db.prepare(`
    INSERT INTO admin
    (
      username,
      password
    )
    VALUES (?, ?)
  `).run(
    "admin",
    "admin123"
  );
}

/* =========================================================
   DEFAULT HOMEPAGE SETTINGS
========================================================= */

const defaultSettings = {
  logo_url:
    "/images/logo.png",

  hero_title:
    "Best Deals. Best Prices. DealBaazi.",

  hero_description:
    "Find amazing deals, discounts and offers across mobiles, electronics, fashion, home, beauty and more.",

  hero_button_text:
    "Explore Deals",

  hero_button_link:
    "#deals",

  feature1_icon:
    "🔥",

  feature1_title:
    "Best Deals",

  feature1_description:
    "Handpicked deals at great prices.",

  feature1_enabled:
    "1",

  feature2_icon:
    "💰",

  feature2_title:
    "Save More",

  feature2_description:
    "Compare prices and save money.",

  feature2_enabled:
    "1",

  feature3_icon:
    "⭐",

  feature3_title:
    "Top Rated",

  feature3_description:
    "Discover highly rated products.",

  feature3_enabled:
    "1",

  feature4_icon:
    "⚡",

  feature4_title:
    "Easy Shopping",

  feature4_description:
    "Buy directly from trusted stores.",

  feature4_enabled:
    "1",

  show_hot_deals:
    "1",

  show_top_picks:
    "1",

  show_top_rated:
    "1",

  show_all_deals:
    "1",

  footer_text:
    "DealBaazi helps you discover the best deals, discounts and offers from trusted online stores."
};

const settingInsert =
  db.prepare(`
    INSERT OR IGNORE INTO site_settings
    (
      setting_key,
      setting_value
    )
    VALUES (?, ?)
  `);

Object.entries(
  defaultSettings
).forEach(
  (
    [key, value]
  ) => {
    settingInsert.run(
      key,
      String(value)
    );
  }
);

/* =========================================================
   HELPERS
========================================================= */

function calculateDiscountText(
  price,
  originalPrice
) {
  const p =
    Number(price || 0);

  const op =
    Number(
      originalPrice || 0
    );

  if (
    !p ||
    !op ||
    op <= p
  ) {
    return "";
  }

  const percentage =
    Math.round(
      ((op - p) / op) *
        100
    );

  return (
    percentage +
    "% OFF"
  );
}

function getDiscountPercent(
  price,
  originalPrice
) {
  const p =
    Number(price || 0);

  const op =
    Number(
      originalPrice || 0
    );

  if (
    !p ||
    !op ||
    op <= p
  ) {
    return 0;
  }

  return Math.round(
    ((op - p) / op) *
      100
  );
}

function calculateDealScore(
  product
) {
  const discount =
    getDiscountPercent(
      product.price,
      product.original_price
    );

  const rating =
    Number(
      product.rating || 0
    );

  const clicks =
    Number(
      product.clicks || 0
    );

  return (
    discount * 3 +
    rating * 10 +
    Math.min(
      clicks,
      100
    )
  );
}

function getProductImages(
  productId
) {
  return db.prepare(`
    SELECT *
    FROM product_images
    WHERE product_id = ?
    ORDER BY sort_order ASC, id ASC
  `).all(productId);
}

function getReviewStats(
  productId
) {
  const stats =
    db.prepare(`
      SELECT
        COUNT(*) AS count,
        AVG(rating) AS average
      FROM reviews
      WHERE product_id = ?
        AND approved = 1
    `).get(
      productId
    );

  return {
    count:
      stats.count || 0,

    average:
      Number(
        stats.average || 0
      ).toFixed(1)
  };
}

function getSiteSettings() {
  const rows =
    db.prepare(`
      SELECT
        setting_key,
        setting_value
      FROM site_settings
    `).all();

  const settings = {};

  rows.forEach(
    row => {
      settings[
        row.setting_key
      ] =
        row.setting_value;
    }
  );

  return settings;
}

function getActiveBanners() {
  return db.prepare(`
    SELECT *
    FROM banners
    WHERE active = 1
    ORDER BY sort_order ASC, id ASC
  `).all();
}

function getAllBanners() {
  return db.prepare(`
    SELECT *
    FROM banners
    ORDER BY sort_order ASC, id ASC
  `).all();
}

/* =========================================================
   SEARCH HELPERS
========================================================= */

function getSearchTerms(
  query
) {
  return String(
    query || ""
  )
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function removeCommonWords(
  text
) {
  const commonWords = [
    "the",
    "and",
    "for",
    "with",
    "best",
    "deal",
    "deals",
    "price",
    "buy",
    "online",
    "new",
    "offer",
    "offers"
  ];

  return getSearchTerms(
    text
  ).filter(
    word =>
      !commonWords.includes(
        word
      )
  );
}

function normalizeSearchText(
  text
) {
  return String(
    text || ""
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9\s]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function containsWord(
  text,
  word
) {
  const normalized =
    normalizeSearchText(
      text
    );

  return normalized
    .split(" ")
    .includes(
      normalizeSearchText(
        word
      )
    );
}

function containsPartial(
  text,
  word
) {
  return normalizeSearchText(
    text
  ).includes(
    normalizeSearchText(
      word
    )
  );
}

function calculateSearchScore(
  product,
  query
) {
  const terms =
    removeCommonWords(
      query
    );

  if (
    !terms.length
  ) {
    return 0;
  }

  const name =
    normalizeSearchText(
      product.name
    );

  const description =
    normalizeSearchText(
      product.description
    );

  let score = 0;

  terms.forEach(
    term => {
      if (
        containsWord(
          name,
          term
        )
      ) {
        score += 10;
      } else if (
        containsPartial(
          name,
          term
        )
      ) {
        score += 5;
      }

      if (
        containsPartial(
          description,
          term
        )
      ) {
        score += 2;
      }
    }
  );

  return score;
}

/* =========================================================
   SECURE ADMIN AUTHENTICATION
========================================================= */

/*
   Previous version used:

   let loggedIn = false;

   That was unsafe for a public website because one
   global variable controlled everybody's access.

   Now each browser receives its own signed cookie.

   No additional npm package is required.
*/

const SESSION_COOKIE =
  "dealbaazi_admin_session";

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "dealbaazi-local-secret-change-this-before-production";

const SESSION_MAX_AGE =
  24 * 60 * 60;

/* Create signed session */

function createAdminToken(
  username
) {
  const expires =
    Math.floor(
      Date.now() / 1000
    ) +
    SESSION_MAX_AGE;

  const payload =
    `${username}|${expires}`;

  const signature =
    crypto
      .createHmac(
        "sha256",
        SESSION_SECRET
      )
      .update(
        payload
      )
      .digest("hex");

  return Buffer.from(
    `${payload}|${signature}`
  ).toString(
    "base64url"
  );
}

/* Verify signed session */

function verifyAdminToken(
  token
) {
  try {
    if (!token) {
      return null;
    }

    const decoded =
      Buffer.from(
        token,
        "base64url"
      ).toString(
        "utf8"
      );

    const parts =
      decoded.split("|");

    if (
      parts.length !== 3
    ) {
      return null;
    }

    const username =
      parts[0];

    const expires =
      Number(parts[1]);

    const signature =
      parts[2];

    if (
      !username ||
      !expires ||
      !signature
    ) {
      return null;
    }

    if (
      Math.floor(
        Date.now() / 1000
      ) > expires
    ) {
      return null;
    }

    const payload =
      `${username}|${expires}`;

    const expected =
      crypto
        .createHmac(
          "sha256",
          SESSION_SECRET
        )
        .update(
          payload
        )
        .digest("hex");

    const receivedBuffer =
      Buffer.from(
        signature,
        "utf8"
      );

    const expectedBuffer =
      Buffer.from(
        expected,
        "utf8"
      );

    if (
      receivedBuffer.length !==
      expectedBuffer.length
    ) {
      return null;
    }

    if (
      !crypto.timingSafeEqual(
        receivedBuffer,
        expectedBuffer
      )
    ) {
      return null;
    }

    return {
      username,
      expires
    };
  } catch (error) {
    return null;
  }
}

/* Read cookie */

function getAdminToken(
  req
) {
  const cookieHeader =
    String(
      req.headers.cookie ||
        ""
    );

  if (
    !cookieHeader
  ) {
    return null;
  }

  const cookies = {};

  cookieHeader
    .split(";")
    .forEach(
      part => {
        const index =
          part.indexOf("=");

        if (
          index === -1
        ) {
          return;
        }

        const key =
          part
            .slice(
              0,
              index
            )
            .trim();

        const value =
          part
            .slice(
              index + 1
            )
            .trim();

        cookies[key] =
          value;
      }
    );

  return (
    cookies[
      SESSION_COOKIE
    ] || null
  );
}

/* Check login */

function isLoggedIn(
  req
) {
  const token =
    getAdminToken(
      req
    );

  return Boolean(
    verifyAdminToken(
      token
    )
  );
}

/* Set login cookie */

function setAdminCookie(
  res,
  username
) {
  const token =
    createAdminToken(
      username
    );

  const isProduction =
    process.env.NODE_ENV ===
    "production";

  const cookie =
    [
      `${SESSION_COOKIE}=${token}`,
      "HttpOnly",
      "Path=/",
      "SameSite=Lax",
      `Max-Age=${SESSION_MAX_AGE}`,
      isProduction
        ? "Secure"
        : ""
    ]
      .filter(Boolean)
      .join("; ");

  res.setHeader(
    "Set-Cookie",
    cookie
  );
}

/* Clear login cookie */

function clearAdminCookie(
  res
) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
  );
}

/* =========================================================
   PUBLIC HOME
========================================================= */

app.get(
  "/",
  (req, res) => {
    const products =
      db.prepare(`
        SELECT *
        FROM products
        WHERE visible = 1
        ORDER BY id DESC
      `).all();

    products.forEach(
      product => {
        product.images =
          getProductImages(
            product.id
          );

        product.reviewStats =
          getReviewStats(
            product.id
          );

        product.discountText =
          calculateDiscountText(
            product.price,
            product.original_price
          );

        product.dealScore =
          calculateDealScore(
            product
          );
      }
    );

    const categories =
      db.prepare(`
        SELECT *
        FROM categories
        WHERE active = 1
        ORDER BY sort_order ASC, id ASC
      `).all();

    const hotDeals =
      products
        .filter(
          p =>
            Number(
              p.hot_deal
            ) === 1
        )
        .sort(
          (a, b) =>
            b.dealScore -
            a.dealScore
        );

    const topPicks =
      products
        .filter(
          p =>
            Number(
              p.featured
            ) === 1
        )
        .sort(
          (a, b) =>
            b.dealScore -
            a.dealScore
        );

    const topRated =
      products
        .filter(
          p =>
            Number(
              p.rating || 0
            ) >= 4
        )
        .sort(
          (a, b) =>
            Number(
              b.rating || 0
            ) -
            Number(
              a.rating || 0
            )
        );

    res.render(
      "index",
      {
        products,
        categories,
        hotDeals,
        topPicks,
        topRated,

        selectedCategory:
          null,

        searchQuery:
          "",

        siteSettings:
          getSiteSettings(),

        banners:
          getActiveBanners()
      }
    );
  }
);

/* =========================================================
   SEARCH
========================================================= */

app.get(
  "/search",
  (req, res) => {
    const query =
      String(
        req.query.q || ""
      ).trim();

    const allProducts =
      db.prepare(`
        SELECT *
        FROM products
        WHERE visible = 1
        ORDER BY id DESC
      `).all();

    let products =
      allProducts;

    if (query) {
      products =
        allProducts
          .map(
            product => ({
              ...product,

              searchScore:
                calculateSearchScore(
                  product,
                  query
                )
            })
          )
          .filter(
            product =>
              product.searchScore >
              0
          )
          .sort(
            (a, b) =>
              b.searchScore -
              a.searchScore
          );
    }

    products.forEach(
      product => {
        product.images =
          getProductImages(
            product.id
          );

        product.reviewStats =
          getReviewStats(
            product.id
          );

        product.discountText =
          calculateDiscountText(
            product.price,
            product.original_price
          );

        product.dealScore =
          calculateDealScore(
            product
          );
      }
    );

    const categories =
      db.prepare(`
        SELECT *
        FROM categories
        WHERE active = 1
        ORDER BY sort_order ASC, id ASC
      `).all();

    res.render(
      "index",
      {
        products,
        categories,

        hotDeals: [],
        topPicks: [],
        topRated: [],

        selectedCategory:
          null,

        searchQuery:
          query,

        siteSettings:
          getSiteSettings(),

        banners:
          getActiveBanners()
      }
    );
  }
);

/* =========================================================
   CATEGORY
========================================================= */

app.get(
  "/category/:id",
  (req, res) => {
    const categoryId =
      Number(
        req.params.id
      );

    const category =
      db.prepare(`
        SELECT *
        FROM categories
        WHERE id = ?
      `).get(
        categoryId
      );

    if (!category) {
      return res.redirect(
        "/"
      );
    }

    const products =
      db.prepare(`
        SELECT *
        FROM products
        WHERE visible = 1
          AND category_id = ?
        ORDER BY id DESC
      `).all(
        categoryId
      );

    products.forEach(
      product => {
        product.images =
          getProductImages(
            product.id
          );

        product.reviewStats =
          getReviewStats(
            product.id
          );

        product.discountText =
          calculateDiscountText(
            product.price,
            product.original_price
          );

        product.dealScore =
          calculateDealScore(
            product
          );
      }
    );

    const categories =
      db.prepare(`
        SELECT *
        FROM categories
        WHERE active = 1
        ORDER BY sort_order ASC, id ASC
      `).all();

    res.render(
      "index",
      {
        products,
        categories,
        category,

        selectedCategory:
          category,

        searchQuery:
          "",

        hotDeals: [],
        topPicks: [],
        topRated: [],

        siteSettings:
          getSiteSettings(),

        banners:
          getActiveBanners()
      }
    );
  }
);

/* =========================================================
   PRODUCT DETAILS
========================================================= */

app.get(
  "/product/:id",
  (req, res) => {
    const id =
      Number(
        req.params.id
      );

    const product =
      db.prepare(`
        SELECT
          p.*,
          c.name AS category_name
        FROM products p
        LEFT JOIN categories c
          ON c.id = p.category_id
        WHERE p.id = ?
      `).get(id);

    if (!product) {
      return res
        .status(404)
        .send(
          "Product not found"
        );
    }

    product.images =
      getProductImages(
        id
      );

    product.reviewStats =
      getReviewStats(
        id
      );

    product.discountText =
      calculateDiscountText(
        product.price,
        product.original_price
      );

    const reviews =
      db.prepare(`
        SELECT *
        FROM reviews
        WHERE product_id = ?
          AND approved = 1
        ORDER BY id DESC
      `).all(id);

    res.render(
      "product",
      {
        product,
        reviews,

        siteSettings:
          getSiteSettings()
      }
    );
  }
);

/* =========================================================
   BUY NOW - DIRECT AFFILIATE REDIRECT
========================================================= */

app.get(
  "/buy/:id",
  (req, res) => {
    const id =
      Number(
        req.params.id
      );

    const product =
      db.prepare(`
        SELECT *
        FROM products
        WHERE id = ?
          AND visible = 1
      `).get(id);

    if (!product) {
      return res
        .status(404)
        .send(
          "Product not found"
        );
    }

    db.prepare(`
      UPDATE products
      SET clicks = clicks + 1
      WHERE id = ?
    `).run(id);

    if (
      !product.affiliate_url
    ) {
      return res
        .status(400)
        .send(
          "Affiliate link is not available."
        );
    }

    res.redirect(
      product.affiliate_url
    );
  }
);

/* =========================================================
   PRODUCT REVIEW
========================================================= */

app.post(
  "/product/:id/review",
  (req, res) => {
    const productId =
      Number(
        req.params.id
      );

    const name =
      String(
        req.body.name || ""
      ).trim();

    const rating =
      Number(
        req.body.rating || 5
      );

    const comment =
      String(
        req.body.comment || ""
      ).trim();

    const product =
      db.prepare(`
        SELECT id
        FROM products
        WHERE id = ?
      `).get(
        productId
      );

    if (!product) {
      return res
        .status(404)
        .send(
          "Product not found"
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
      "/product/" +
        productId
    );
  }
);

/* =========================================================
   LOGIN
========================================================= */

app.get(
  "/login",
  (req, res) => {
    if (
      isLoggedIn(req)
    ) {
      return res.redirect(
        "/admin"
      );
    }

    res.render(
      "login",
      {
        error: null
      }
    );
  }
);

app.post(
  "/login",
  (req, res) => {
    const username =
      String(
        req.body.username ||
          ""
      );

    const password =
      String(
        req.body.password ||
          ""
      );

    const admin =
      db.prepare(`
        SELECT *
        FROM admin
        WHERE username = ?
        LIMIT 1
      `).get(
        username
      );

    if (
      admin &&
      admin.password ===
        password
    ) {
      setAdminCookie(
        res,
        admin.username
      );

      return res.redirect(
        "/admin"
      );
    }

    res.render(
      "login",
      {
        error:
          "Invalid username or password."
      }
    );
  }
);

/* =========================================================
   ADMIN DASHBOARD
========================================================= */

app.get(
  "/admin",
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    const products =
      db.prepare(`
        SELECT
          p.*,
          c.name AS category_name
        FROM products p
        LEFT JOIN categories c
          ON c.id = p.category_id
        ORDER BY p.id DESC
      `).all();

    const categories =
      db.prepare(`
        SELECT *
        FROM categories
        ORDER BY sort_order ASC, id ASC
      `).all();

    const reviews =
      db.prepare(`
        SELECT
          r.*,
          p.name AS product_name
        FROM reviews r
        LEFT JOIN products p
          ON p.id = r.product_id
        ORDER BY r.id DESC
      `).all();

    const stats = {
      totalProducts:
        products.length,

      liveProducts:
        products.filter(
          p =>
            Number(
              p.visible
            ) === 1
        ).length,

      categories:
        categories.length,

      reviews:
        reviews.length
    };

    res.render(
      "admin",
      {
        products,
        categories,
        reviews,
        stats,

        siteSettings:
          getSiteSettings(),

        banners:
          getAllBanners()
      }
    );
  }
);

/* =========================================================
   HOMEPAGE SETTINGS SAVE
========================================================= */

app.post(
  "/admin/homepage/save",
  homepageUpload,
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    const fields = [
      "hero_title",
      "hero_description",
      "hero_button_text",
      "hero_button_link",

      "feature1_icon",
      "feature1_title",
      "feature1_description",

      "feature2_icon",
      "feature2_title",
      "feature2_description",

      "feature3_icon",
      "feature3_title",
      "feature3_description",

      "feature4_icon",
      "feature4_title",
      "feature4_description",

      "footer_text"
    ];

    const updateSetting =
      db.prepare(`
        INSERT INTO site_settings
        (
          setting_key,
          setting_value
        )
        VALUES (?, ?)
        ON CONFLICT(setting_key)
        DO UPDATE SET
          setting_value =
            excluded.setting_value
      `);

    const saveSettings =
      db.transaction(
        () => {
          fields.forEach(
            key => {
              updateSetting.run(
                key,
                String(
                  req.body[
                    key
                  ] || ""
                )
              );
            }
          );

          updateSetting.run(
            "feature1_enabled",
            req.body
              .feature1_enabled
              ? "1"
              : "0"
          );

          updateSetting.run(
            "feature2_enabled",
            req.body
              .feature2_enabled
              ? "1"
              : "0"
          );

          updateSetting.run(
            "feature3_enabled",
            req.body
              .feature3_enabled
              ? "1"
              : "0"
          );

          updateSetting.run(
            "feature4_enabled",
            req.body
              .feature4_enabled
              ? "1"
              : "0"
          );

          updateSetting.run(
            "show_hot_deals",
            req.body
              .show_hot_deals
              ? "1"
              : "0"
          );

          updateSetting.run(
            "show_top_picks",
            req.body
              .show_top_picks
              ? "1"
              : "0"
          );

          updateSetting.run(
            "show_top_rated",
            req.body
              .show_top_rated
              ? "1"
              : "0"
          );

          updateSetting.run(
            "show_all_deals",
            req.body
              .show_all_deals
              ? "1"
              : "0"
          );

          if (
            req.files &&
            req.files.logo &&
            req.files.logo[0]
          ) {
            const logoPath =
              "/uploads/" +
              req.files.logo[0]
                .filename;

            updateSetting.run(
              "logo_url",
              logoPath
            );
          }

          if (
            req.files &&
            req.files.hero_image &&
            req.files.hero_image[0]
          ) {
            const heroPath =
              "/uploads/" +
              req.files.hero_image[0]
                .filename;

            updateSetting.run(
              "hero_image",
              heroPath
            );
          }
        }
      );

    saveSettings();

    res.redirect(
      "/admin?homepage=saved"
    );
  }
);

/* =========================================================
   BANNER ADD
========================================================= */

app.post(
  "/admin/banners/add",
  upload.single(
    "banner_image"
  ),
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    let imageUrl =
      String(
        req.body.image_url ||
          ""
      ).trim();

    if (req.file) {
      imageUrl =
        "/uploads/" +
        req.file.filename;
    }

    db.prepare(`
      INSERT INTO banners
      (
        image_url,
        heading,
        description,
        button_text,
        link_url,
        active,
        sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      imageUrl,

      String(
        req.body.heading ||
          ""
      ),

      String(
        req.body.description ||
          ""
      ),

      String(
        req.body.button_text ||
          ""
      ),

      String(
        req.body.link_url ||
          ""
      ),

      req.body.active
        ? 1
        : 0,

      Number(
        req.body.sort_order ||
          0
      )
    );

    res.redirect(
      "/admin?banner=saved"
    );
  }
);

/* =========================================================
   BANNER EDIT
========================================================= */

app.post(
  "/admin/banners/edit/:id",
  upload.single(
    "banner_image"
  ),
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    const id =
      Number(
        req.params.id
      );

    const banner =
      db.prepare(`
        SELECT *
        FROM banners
        WHERE id = ?
      `).get(id);

    if (!banner) {
      return res.redirect(
        "/admin"
      );
    }

    let imageUrl =
      String(
        req.body.image_url ||
          banner.image_url ||
          ""
      ).trim();

    if (req.file) {
      imageUrl =
        "/uploads/" +
        req.file.filename;
    }

    db.prepare(`
      UPDATE banners
      SET
        image_url = ?,
        heading = ?,
        description = ?,
        button_text = ?,
        link_url = ?,
        active = ?,
        sort_order = ?
      WHERE id = ?
    `).run(
      imageUrl,

      String(
        req.body.heading ||
          ""
      ),

      String(
        req.body.description ||
          ""
      ),

      String(
        req.body.button_text ||
          ""
      ),

      String(
        req.body.link_url ||
          ""
      ),

      req.body.active
        ? 1
        : 0,

      Number(
        req.body.sort_order ||
          0
      ),

      id
    );

    res.redirect(
      "/admin?banner=updated"
    );
  }
);

/* =========================================================
   BANNER DELETE
========================================================= */

app.post(
  "/admin/banners/delete/:id",
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    const id =
      Number(
        req.params.id
      );

    db.prepare(`
      DELETE FROM banners
      WHERE id = ?
    `).run(id);

    res.redirect(
      "/admin?banner=deleted"
    );
  }
);

/* =========================================================
   BANNER TOGGLE
========================================================= */

app.post(
  "/admin/banners/toggle/:id",
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    const id =
      Number(
        req.params.id
      );

    db.prepare(`
      UPDATE banners
      SET active =
        CASE
          WHEN active = 1 THEN 0
          ELSE 1
        END
      WHERE id = ?
    `).run(id);

    res.redirect(
      "/admin"
    );
  }
);

/* =========================================================
   CATEGORY ADD
========================================================= */

app.post(
  "/admin/categories/add",
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    const name =
      String(
        req.body.name ||
          ""
      ).trim();

    const sortOrder =
      Number(
        req.body.sort_order ||
          0
      );

    if (!name) {
      return res.redirect(
        "/admin"
      );
    }

    db.prepare(`
      INSERT INTO categories
      (
        name,
        sort_order,
        active
      )
      VALUES (?, ?, 1)
    `).run(
      name,
      sortOrder
    );

    res.redirect(
      "/admin"
    );
  }
);

/* =========================================================
   CATEGORY EDIT
========================================================= */

app.post(
  "/admin/categories/edit/:id",
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    const id =
      Number(
        req.params.id
      );

    const name =
      String(
        req.body.name ||
          ""
      ).trim();

    const sortOrder =
      Number(
        req.body.sort_order ||
          0
      );

    const active =
      req.body.active
        ? 1
        : 0;

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

    res.redirect(
      "/admin"
    );
  }
);

/* =========================================================
   CATEGORY DELETE
========================================================= */

app.post(
  "/admin/categories/delete/:id",
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    const id =
      Number(
        req.params.id
      );

    db.prepare(`
      DELETE FROM categories
      WHERE id = ?
    `).run(id);

    res.redirect(
      "/admin"
    );
  }
);

/* =========================================================
   PRODUCT ADD
========================================================= */

app.post(
  "/admin/add",
  multiUpload,
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    const name =
      String(
        req.body.name ||
          ""
      ).trim();

    const price =
      Number(
        req.body.sellingPrice ||
          req.body.price ||
          0
      );

    const originalPrice =
      Number(
        req.body.originalPrice ||
          req.body.original_price ||
          0
      );

    const rating =
      Number(
        req.body.rating ||
          0
      );

    const categoryId =
      Number(
        req.body.category_id ||
          0
      ) || null;

    const affiliateUrl =
      String(
        req.body.affiliate_url ||
          ""
      ).trim();

    const expiryDate =
      String(
        req.body.expiry_date ||
          ""
      );

    const description =
      String(
        req.body.description ||
          ""
      );

    const discount =
      calculateDiscountText(
        price,
        originalPrice
      );

    let imageUrl = "";

    if (
      req.files &&
      req.files.image &&
      req.files.image[0]
    ) {
      imageUrl =
        "/uploads/" +
        req.files.image[0]
          .filename;
    } else if (
      req.files &&
      req.files.images &&
      req.files.images[0]
    ) {
      imageUrl =
        "/uploads/" +
        req.files.images[0]
          .filename;
    }

    const result =
      db.prepare(`
        INSERT INTO products
        (
          name,
          price,
          discount,
          rating,
          affiliate_url,
          image_url,
          featured,
          trending,
          visible,
          expiry_date,
          category_id,
          description,
          original_price,
          hot_deal
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name,
        price,
        discount,
        rating,
        affiliateUrl,
        imageUrl,

        req.body.featured
          ? 1
          : 0,

        req.body.trending
          ? 1
          : 0,

        req.body.visible
          ? 1
          : 0,

        expiryDate,
        categoryId,
        description,
        originalPrice,

        req.body.hot_deal
          ? 1
          : 0
      );

    const productId =
      result.lastInsertRowid;

    if (
      req.files &&
      req.files.images
    ) {
      const insertImage =
        db.prepare(`
          INSERT INTO product_images
          (
            product_id,
            image_url,
            sort_order
          )
          VALUES (?, ?, ?)
        `);

      req.files.images.forEach(
        (
          file,
          index
        ) => {
          insertImage.run(
            productId,
            "/uploads/" +
              file.filename,
            index
          );
        }
      );
    }

    res.redirect(
      "/admin"
    );
  }
);

/* =========================================================
   PRODUCT EDIT
========================================================= */

app.post(
  "/admin/edit/:id",
  multiUpload,
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    const id =
      Number(
        req.params.id
      );

    const product =
      db.prepare(`
        SELECT *
        FROM products
        WHERE id = ?
      `).get(id);

    if (!product) {
      return res.redirect(
        "/admin"
      );
    }

    const name =
      String(
        req.body.name ||
          ""
      ).trim();

    const price =
      Number(
        req.body.sellingPrice ||
          req.body.price ||
          0
      );

    const originalPrice =
      Number(
        req.body.originalPrice ||
          req.body.original_price ||
          0
      );

    const rating =
      Number(
        req.body.rating ||
          0
      );

    const categoryId =
      Number(
        req.body.category_id ||
          0
      ) || null;

    const affiliateUrl =
      String(
        req.body.affiliate_url ||
          ""
      ).trim();

    const expiryDate =
      String(
        req.body.expiry_date ||
          ""
      );

    const description =
      String(
        req.body.description ||
          ""
      );

    const discount =
      calculateDiscountText(
        price,
        originalPrice
      );

    let imageUrl =
      product.image_url ||
      "";

    if (
      req.files &&
      req.files.image &&
      req.files.image[0]
    ) {
      imageUrl =
        "/uploads/" +
        req.files.image[0]
          .filename;
    } else if (
      req.files &&
      req.files.images &&
      req.files.images[0] &&
      !imageUrl
    ) {
      imageUrl =
        "/uploads/" +
        req.files.images[0]
          .filename;
    }

    db.prepare(`
      UPDATE products
      SET
        name = ?,
        price = ?,
        discount = ?,
        rating = ?,
        affiliate_url = ?,
        image_url = ?,
        featured = ?,
        trending = ?,
        visible = ?,
        expiry_date = ?,
        category_id = ?,
        description = ?,
        original_price = ?,
        hot_deal = ?
      WHERE id = ?
    `).run(
      name,
      price,
      discount,
      rating,
      affiliateUrl,
      imageUrl,

      req.body.featured
        ? 1
        : 0,

      req.body.trending
        ? 1
        : 0,

      req.body.visible
        ? 1
        : 0,

      expiryDate,
      categoryId,
      description,
      originalPrice,

      req.body.hot_deal
        ? 1
        : 0,

      id
    );

    if (
      req.files &&
      req.files.images
    ) {
      const insertImage =
        db.prepare(`
          INSERT INTO product_images
          (
            product_id,
            image_url,
            sort_order
          )
          VALUES (?, ?, ?)
        `);

      req.files.images.forEach(
        (
          file,
          index
        ) => {
          insertImage.run(
            id,
            "/uploads/" +
              file.filename,
            index
          );
        }
      );
    }

    res.redirect(
      "/admin"
    );
  }
);

/* =========================================================
   PRODUCT DELETE
========================================================= */

app.post(
  "/admin/delete/:id",
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    const id =
      Number(
        req.params.id
      );

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

    res.redirect(
      "/admin"
    );
  }
);

/* =========================================================
   REVIEW DELETE
========================================================= */

app.post(
  "/admin/reviews/delete/:id",
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    const id =
      Number(
        req.params.id
      );

    db.prepare(`
      DELETE FROM reviews
      WHERE id = ?
    `).run(id);

    res.redirect(
      "/admin"
    );
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.get(
  "/logout",
  (req, res) => {
    clearAdminCookie(
      res
    );

    res.redirect(
      "/login"
    );
  }
);

/* =========================================================
   PASSWORD PAGE
========================================================= */

app.get(
  "/password",
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    res.render(
      "password",
      {
        error:
          req.query.error ||
          null,

        success:
          req.query.success ||
          null
      }
    );
  }
);

/* =========================================================
   CHANGE PASSWORD
========================================================= */

app.post(
  "/admin/change-password",
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    const oldPassword =
      String(
        req.body.old_password ||
          req.body.currentPassword ||
          ""
      );

    const newPassword =
      String(
        req.body.new_password ||
          req.body.newPassword ||
          ""
      );

    const confirmPassword =
      String(
        req.body.confirm_password ||
          req.body.confirmPassword ||
          ""
      );

    const admin =
      db.prepare(`
        SELECT *
        FROM admin
        LIMIT 1
      `).get();

    if (
      !admin ||
      admin.password !==
        oldPassword
    ) {
      return res.redirect(
        "/password?error=Old%20password%20is%20incorrect"
      );
    }

    if (
      !newPassword ||
      newPassword !==
        confirmPassword
    ) {
      return res.redirect(
        "/password?error=New%20passwords%20do%20not%20match"
      );
    }

    db.prepare(`
      UPDATE admin
      SET password = ?
      WHERE id = ?
    `).run(
      newPassword,
      admin.id
    );

    /*
       Existing login cookie remains valid.
       User can continue using admin panel.
    */

    res.redirect(
      "/password?success=Password%20changed%20successfully"
    );
  }
);

/* =========================================================
   OLD PASSWORD ROUTE - PRESERVED
========================================================= */

app.post(
  "/password",
  (req, res) => {
    if (
      !isLoggedIn(req)
    ) {
      return res.redirect(
        "/login"
      );
    }

    const oldPassword =
      String(
        req.body.old_password ||
          ""
      );

    const newPassword =
      String(
        req.body.new_password ||
          ""
      );

    const confirmPassword =
      String(
        req.body.confirm_password ||
          ""
      );

    const admin =
      db.prepare(`
        SELECT *
        FROM admin
        LIMIT 1
      `).get();

    if (
      !admin ||
      admin.password !==
        oldPassword
    ) {
      return res.render(
        "password",
        {
          error:
            "Old password is incorrect.",

          success:
            null
        }
      );
    }

    if (
      !newPassword ||
      newPassword !==
        confirmPassword
    ) {
      return res.render(
        "password",
        {
          error:
            "New passwords do not match.",

          success:
            null
        }
      );
    }

    db.prepare(`
      UPDATE admin
      SET password = ?
      WHERE id = ?
    `).run(
      newPassword,
      admin.id
    );

    res.render(
      "password",
      {
        error:
          null,

        success:
          "Password changed successfully."
      }
    );
  }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    console.error(err);

    res
      .status(500)
      .send(
        "Something went wrong: " +
          err.message
      );
  }
);

/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `DealBaazi server running on port ${PORT}`
    );

    console.log(
      `Database: ${dbPath}`
    );

    console.log(
      `Uploads: ${uploadsDir}`
    );
  }
);