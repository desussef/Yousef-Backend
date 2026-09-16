import 'dotenv/config'
import pg from 'pg'

const groups = [
  ['Branding', 'Creative Director', ['Visual Identity', 'Campaign Concept', 'Brand Refresh']],
  ['Photography', 'Photographer', ['Studio Session', 'Editorial Shoot', 'Product Story']],
  ['Commercial Ads', 'Director & Editor', ['Samsung - For pros like you', 'Samsonite - Casper Ruud', 'Bavaria - Family Brewed', 'Mey & Edlich - Erbstuck-Lederjacke', 'Ambiance - Het Grote Genieten', 'Red Band - Kameleon', 'ABN AMRO - Gelijke kansen', 'Plus - Goed Eten', 'Trinamics - Taking on Tomorrow', 'Wallbox - The Power Behind', 'Auping - Dubbel zo mooi', 'Sunshower - Feel What Light Can Do', 'Nike - Run Your City']],
]
const videoTitle = 'Nike - Run Your City'
const videoUrl = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()
try {
  await client.query('BEGIN')
  const count = await client.query('SELECT count(*)::int AS count FROM projects')
  if (count.rows[0].count) throw new Error('Projects already exist; seed aborted to protect existing content.')
  const categories = new Map()
  for (const [index, [name]] of groups.entries()) {
    const row = await client.query('INSERT INTO categories(name,sort_order) VALUES($1,$2) RETURNING id', [name, index])
    categories.set(name, row.rows[0].id)
  }
  let order = 0
  for (const [name, role, titles] of groups) for (const title of titles) {
    const isVideo = title === videoTitle
    const image = isVideo ? videoUrl : `https://picsum.photos/seed/work-${order}/1600/900`
    await client.query('INSERT INTO projects(category_id,title,client,role,year,description,thumb_url,hero_url,published,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9)', [categories.get(name), title, `Client ${String.fromCharCode(65 + (order % 6))}`, role, 2022 + (order % 4), 'A selected commercial project shaped around clean direction, tactile visuals, and a focused brand story.', isVideo ? videoUrl : `https://picsum.photos/seed/work-${order}/800/600`, image, order])
    order += 1
  }
  await client.query("INSERT INTO site_settings(id,name,role,instagram,vimeo,linkedin) VALUES(true,'Yousef Al Kassabji','Art Director · Commercial Visuals',$1,$2,$3)", [JSON.stringify({ handle: '@usefgraphs', url: 'https://www.instagram.com/usefgraphs' }), JSON.stringify({ handle: 'usefgraphs', url: 'https://vimeo.com/usefgraphs' }), JSON.stringify({ handle: 'usefgraphs', url: 'https://linkedin.com/in/usefgraphs' })])
  await client.query("INSERT INTO contact_settings(id,email,phone,location,photo_url) VALUES(true,'hello@example.com','+1 555 0100','Dubai, UAE','https://picsum.photos/seed/contact-portrait/840/1600')")
  const nav = [['Work', '#work'], ['About', '#about'], ['Featured Clients', '#about/featured-clients'], ['Contact', '#contact']]
  for (const [index, [label, href]] of nav.entries()) await client.query('INSERT INTO nav_items(label,href,sort_order) VALUES($1,$2,$3)', [label, href, index])
  const bio = [
    'Yousef Al Kassabji is a Jeddah based F&B Creative and Design Leading with over 7 years of experience working across the F&B industry, developing brands, leading campaigns, and bringing creative ideas from concept to production.',
    'His work combines Art Direction, Brand Development, Campaigns, Photography, Video Production, and Design. What defines his approach is the ability to take a creative idea beyond the design stage, shaping the visual direction, leading the campaign, directing the production, and making sure the final result feels consistent across every touchpoint.',
  ]
  for (const [index, body] of bio.entries()) await client.query('INSERT INTO bio_paragraphs(body,sort_order) VALUES($1,$2)', [body, index])
  await client.query('COMMIT'); console.log(`Imported ${order} projects and current editable content.`)
} catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release(); await pool.end() }
