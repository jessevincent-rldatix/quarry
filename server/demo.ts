import type { Database } from 'sql.js'

/** Small deterministic generator so the demo data is the same on every start. */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const FIRST = ['Ada', 'Ben', 'Chloe', 'Dev', 'Elena', 'Farid', 'Grace', 'Hugo', 'Ines', 'Jon', 'Kira', 'Liam', 'Mina', 'Noah', 'Opal', 'Priya']
const LAST = ['Archer', 'Bell', 'Costa', 'Dunn', 'Eze', 'Frost', 'Gill', 'Hale', 'Ito', 'Jones', 'Khan', 'Lowe', 'Moss', 'Nash', 'Okoro', 'Park']
const CITIES = ['London', 'Leeds', 'Bristol', 'Glasgow', 'Cardiff', 'Belfast', 'York', 'Bath']
const PRODUCTS: [string, string, number][] = [
  ['Field notebook', 'stationery', 6.5], ['Fountain pen', 'stationery', 24], ['Desk lamp', 'home', 39.99],
  ['Wool blanket', 'home', 64], ['Enamel mug', 'kitchen', 11], ['Cast iron pan', 'kitchen', 45],
  ['Canvas tote', 'bags', 18], ['Day pack', 'bags', 72], ['Trail socks', 'clothing', 9.5],
  ['Rain shell', 'clothing', 120], ['Pocket knife', 'outdoor', 32], ['Head torch', 'outdoor', 27.5],
]
const STATUSES = ['delivered', 'delivered', 'delivered', 'delivered', 'shipped', 'shipped', 'processing', 'refunded', 'cancelled']

export function seedDemo(db: Database): void {
  const rand = rng(42)
  const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)]
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = (dayOfYear: number, withTime = true) => {
    const d = new Date(Date.UTC(2026, 0, 1 + dayOfYear, Math.floor(rand() * 12) + 8, Math.floor(rand() * 60)))
    const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    return withTime ? `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : day
  }

  db.run(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, city TEXT, joined_on TEXT NOT NULL, marketing_opt_in INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price REAL NOT NULL, in_stock INTEGER NOT NULL);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), status TEXT NOT NULL, total REAL NOT NULL, placed_at TEXT NOT NULL, shipped_at TEXT);
    CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, unit_price REAL NOT NULL);
    CREATE VIEW order_summary AS
      SELECT o.id AS order_id, c.name AS customer, o.status, o.total, o.placed_at
      FROM orders o JOIN customers c ON c.id = o.customer_id;
  `)

  db.run('BEGIN')
  for (let i = 1; i <= 120; i++) {
    const first = pick(FIRST)
    const last = pick(LAST)
    db.run('INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?)', [
      i, `${first} ${last}`, `${first}.${last}${i}@example.com`.toLowerCase(), rand() < 0.08 ? null : pick(CITIES),
      date(Math.floor(rand() * 200) - 300, false), rand() < 0.4 ? 1 : 0,
    ])
  }
  PRODUCTS.forEach(([name, category, price], i) => {
    db.run('INSERT INTO products VALUES (?, ?, ?, ?, ?)', [i + 1, name, category, price, Math.floor(rand() * 200)])
  })
  let itemId = 1
  for (let orderId = 1; orderId <= 600; orderId++) {
    const status = pick(STATUSES)
    const day = Math.floor(rand() * 270)
    let total = 0
    const lines = 1 + Math.floor(rand() * 4)
    const items: [number, number, number][] = []
    for (let l = 0; l < lines; l++) {
      const productIndex = Math.floor(rand() * PRODUCTS.length)
      const quantity = 1 + Math.floor(rand() * 3)
      total += PRODUCTS[productIndex][2] * quantity
      items.push([productIndex + 1, quantity, PRODUCTS[productIndex][2]])
    }
    db.run('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)', [
      orderId, 1 + Math.floor(rand() * 120), status, Math.round(total * 100) / 100, date(day),
      status === 'delivered' || status === 'shipped' ? date(day + 1 + Math.floor(rand() * 3)) : null,
    ])
    for (const [productId, quantity, price] of items) {
      db.run('INSERT INTO order_items VALUES (?, ?, ?, ?, ?)', [itemId++, orderId, productId, quantity, price])
    }
  }
  db.run('COMMIT')
}
