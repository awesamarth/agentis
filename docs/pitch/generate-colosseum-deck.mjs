import pptxgen from 'pptxgenjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const out = path.join(__dirname, 'agentis-colosseum-deck.pptx')

const assets = {
  agentis: path.join(root, 'apps/next-app/public/agentis-mark.png'),
  solana: path.join(root, 'apps/next-app/public/solana-logo.png'),
  jupiter: path.join(root, 'apps/next-app/public/jupiter-logo.png'),
}

const C = {
  bg: 'F7F3EA',
  ink: '17130F',
  muted: '6B6459',
  line: 'D9D0BE',
  card: 'FFFFFF',
  green: '2F7B46',
  mint: 'B8D8C0',
  blue: '315A8A',
  purple: '6D4AFF',
  yellow: 'D4FF56',
}

const slides = [
  {
    title: 'Agentis',
    sentence: 'Complete financial infrastructure for AI agents on Solana.',
    note: 'Agentis is complete financial infrastructure for AI agents on Solana: wallets, payments, policy enforcement, privacy, and yield.',
    visual: 'title',
  },
  {
    title: 'Agents are becoming spenders',
    sentence: 'Crypto agents are starting to pay for real work.',
    note: 'The shift is not just chatbots. Agents are moving toward commerce: paying for data, paid APIs, compute, services, swaps, and protocol actions.',
    visual: 'spenders',
  },
  {
    title: 'The stack is scattered',
    sentence: 'Every serious agent needs five financial primitives.',
    note: 'The primitives exist in the ecosystem, but they are separate. A builder has to integrate and operate each one before their agent can spend safely.',
    visual: 'five',
  },
  {
    title: 'Builders do the plumbing',
    sentence: 'Today, Solana agent teams stitch the money stack by hand.',
    note: 'This is the actual pain. The problem is not that one primitive is missing. The problem is fragmentation, risk, and time lost before a team can ship a useful spending agent.',
    visual: 'tangle',
  },
  {
    title: 'One control plane',
    sentence: 'Agentis gives every agent a wallet and financial control plane.',
    note: 'Agentis creates hosted or local wallets for agents and wraps them with payments, policies, privacy, and yield. Builders can use the dashboard, CLI, SDK, or MCP.',
    visual: 'hub',
  },
  {
    title: 'Spend without losing control',
    sentence: 'Agents can pay APIs, obey budgets, move privately, and earn on idle funds.',
    note: 'Agentis is not one feature. It is the financial operating layer around the agent wallet: x402 and MPP payments, spending controls, Umbra privacy, and Jupiter Earn.',
    visual: 'flows',
  },
  {
    title: 'The demo already works',
    sentence: 'The product works across dashboard, CLI, SDK, and MCP.',
    note: 'Agentis already supports hosted agents, local wallets, x402 and MPP paid fetch, policy checks, Umbra flows, Jupiter Earn, and MCP tools. The demo is not just mock UI.',
    visual: 'surfaces',
  },
  {
    title: 'The next agent apps need money rails',
    sentence: 'Agentis is the financial layer for autonomous Solana apps.',
    note: 'The wedge is Solana agent builders and paid API providers. The long-term platform is the financial layer that lets autonomous apps hold, spend, protect, and manage money.',
    visual: 'base',
  },
]

const pptx = new pptxgen()
pptx.layout = 'LAYOUT_WIDE'
pptx.author = 'Agentis'
pptx.company = 'Agentis'
pptx.subject = 'Colosseum pitch deck'
pptx.title = 'Agentis Colosseum Pitch Deck'
pptx.lang = 'en-US'
pptx.theme = {
  headFontFace: 'Arial',
  bodyFontFace: 'Arial',
  lang: 'en-US',
}

function addText(slide, text, options) {
  slide.addText(text, {
    fontFace: 'Arial',
    color: C.ink,
    margin: 0,
    breakLine: false,
    fit: 'shrink',
    ...options,
  })
}

function addFooter(slide, index) {
  addText(slide, 'Agentis', { x: 0.55, y: 7.05, w: 1.4, h: 0.18, fontSize: 8, color: C.muted, bold: true })
  addText(slide, `${index + 1}/8`, { x: 12.25, y: 7.05, w: 0.55, h: 0.18, fontSize: 8, color: C.muted, align: 'right' })
}

function addSentence(slide, sentence) {
  addText(slide, sentence, {
    x: 0.68,
    y: 0.55,
    w: 6.05,
    h: 1.85,
    fontSize: 31,
    bold: true,
    valign: 'mid',
    breakLine: false,
    fit: 'shrink',
  })
}

function addTitleSentence(slide, sentence) {
  addText(slide, sentence, {
    x: 0.82,
    y: 3.28,
    w: 5.35,
    h: 1.18,
    fontSize: 23,
    bold: true,
    valign: 'mid',
    breakLine: false,
    fit: 'shrink',
  })
}

function addKicker(slide, title) {
  addText(slide, title.toUpperCase(), {
    x: 0.72,
    y: 0.34,
    w: 4.4,
    h: 0.2,
    fontSize: 7.8,
    bold: true,
    color: C.muted,
    charSpace: 1.2,
  })
}

function card(slide, x, y, w, h, fill = C.card, line = C.line, radius = true) {
  slide.addShape(radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
    x, y, w, h,
    rectRadius: 0.08,
    fill: { color: fill },
    line: { color: line, width: 1 },
  })
}

function pill(slide, text, x, y, w, color = C.ink, fill = C.card) {
  card(slide, x, y, w, 0.38, fill, color)
  addText(slide, text, { x: x + 0.1, y: y + 0.11, w: w - 0.2, h: 0.12, fontSize: 8, bold: true, color, align: 'center' })
}

function line(slide, x1, y1, x2, y2, color = C.line, width = 1.5) {
  slide.addShape(pptx.ShapeType.line, {
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1,
    line: { color, width, beginArrowType: 'none', endArrowType: 'none' },
  })
}

function circle(slide, x, y, size, color, text, fontSize = 9) {
  slide.addShape(pptx.ShapeType.ellipse, {
    x, y, w: size, h: size,
    fill: { color },
    line: { color, transparency: 100 },
  })
  if (text) addText(slide, text, { x, y: y + size / 2 - 0.06, w: size, h: 0.12, fontSize, bold: true, align: 'center', color: C.ink })
}

function addLogo(slide, image, x, y, size) {
  slide.addImage({ path: image, x, y, w: size, h: size })
}

function visualOrbit(slide) {
  addLogo(slide, assets.agentis, 8.15, 2.35, 1.25)
  const items = [
    ['wallets', 7.2, 1.35, C.card],
    ['payments', 9.35, 1.55, 'EAF7EE'],
    ['policies', 10.0, 3.0, 'F6F1FF'],
    ['privacy', 8.95, 4.45, 'EEF6FF'],
    ['yield', 6.95, 4.15, 'F3FFE5'],
  ]
  for (const [text, x, y, fill] of items) {
    line(slide, 8.76, 2.96, x + 0.65, y + 0.19, C.line, 1.2)
    pill(slide, text, x, y, 1.3, C.ink, fill)
  }
}

function visualTitle(slide) {
  addLogo(slide, assets.agentis, 7.55, 1.45, 2.25)
  addText(slide, 'Agentis', {
    x: 0.78,
    y: 1.25,
    w: 5.8,
    h: 0.95,
    fontSize: 54,
    bold: true,
    fit: 'shrink',
  })
  addTitleSentence(slide, 'Complete financial infrastructure for AI agents on Solana.')
  const items = ['wallets', 'payments', 'policies', 'privacy', 'yield']
  items.forEach((item, i) => {
    pill(slide, item, 0.82 + i * 1.06, 4.82, 0.92, C.ink, i === 4 ? 'F3FFE5' : C.card)
  })
}

function visualSpenders(slide) {
  addLogo(slide, assets.agentis, 7.0, 3.0, 0.9)
  const targets = [
    ['paid APIs', 9.2, 1.45, C.green],
    ['data', 10.3, 2.55, C.blue],
    ['compute', 9.8, 3.85, C.purple],
    ['protocols', 8.4, 4.75, C.ink],
  ]
  for (const [text, x, y, color] of targets) {
    line(slide, 7.9, 3.45, x, y + 0.18, color, 2)
    pill(slide, text, x, y, 1.25, color, C.card)
  }
  pill(slide, 'agent wallet', 6.65, 4.05, 1.55, C.ink, 'F5F0E8')
}

function visualFive(slide) {
  const items = ['wallet custody', 'paid APIs', 'spend limits', 'private flows', 'idle yield']
  items.forEach((item, i) => {
    const x = 6.95 + (i % 2) * 2.45
    const y = 1.25 + Math.floor(i / 2) * 1.12
    card(slide, x, y, 2.0, 0.7, i === 4 ? 'F3FFE5' : C.card, C.line)
    addText(slide, item, { x: x + 0.18, y: y + 0.27, w: 1.65, h: 0.12, fontSize: 9, bold: true, align: 'center' })
  })
  addText(slide, '5 separate jobs before the agent can safely spend', { x: 6.95, y: 4.85, w: 4.45, h: 0.3, fontSize: 10, color: C.muted, align: 'center' })
}

function visualTangle(slide) {
  addLogo(slide, assets.agentis, 6.7, 2.95, 0.75)
  const services = [
    ['wallet', 9.6, 1.0],
    ['payment', 10.4, 2.2],
    ['policy', 9.85, 3.45],
    ['privacy', 10.45, 4.65],
    ['yield', 8.95, 5.35],
  ]
  services.forEach(([text, x, y], i) => {
    line(slide, 7.35, 3.35, x, y + 0.18, [C.green, C.blue, C.purple, C.yellow, C.ink][i], 1.8)
    line(slide, 7.35, 3.35, x - 0.45, y + 0.5, [C.line, C.mint, C.line, C.mint, C.line][i], 1.2)
    pill(slide, text, x, y, 1.15, C.ink, C.card)
  })
}

function visualHub(slide) {
  addLogo(slide, assets.agentis, 8.15, 2.75, 1.0)
  card(slide, 7.15, 3.85, 3.0, 0.55, 'F5F0E8', C.ink)
  addText(slide, 'Agentis control plane', { x: 7.3, y: 4.06, w: 2.7, h: 0.12, fontSize: 10, bold: true, align: 'center' })
  const nodes = [
    ['Solana', 6.7, 1.35, assets.solana],
    ['x402 / MPP', 9.9, 1.35, null],
    ['Umbra', 6.45, 5.15, null],
    ['Jupiter', 9.95, 5.05, assets.jupiter],
  ]
  nodes.forEach(([text, x, y, image]) => {
    line(slide, 8.65, 3.4, x + 0.55, y + 0.35, C.line, 1.4)
    card(slide, x, y, 1.65, 0.72, C.card, C.line)
    if (image) addLogo(slide, image, x + 0.16, y + 0.16, 0.38)
    addText(slide, text, { x: x + (image ? 0.63 : 0.14), y: y + 0.3, w: image ? 0.9 : 1.35, h: 0.12, fontSize: 8.2, bold: true, align: image ? 'left' : 'center' })
  })
}

function visualFlows(slide) {
  const flows = [
    ['pay APIs', 'x402 / MPP', C.green],
    ['obey budgets', 'policy engine', C.purple],
    ['move privately', 'Umbra', C.blue],
    ['earn yield', 'Jupiter Earn', C.yellow],
  ]
  flows.forEach(([title, sub, color], i) => {
    const x = 6.75 + (i % 2) * 2.55
    const y = 1.45 + Math.floor(i / 2) * 1.8
    card(slide, x, y, 2.05, 1.05, C.card, color)
    circle(slide, x + 0.18, y + 0.22, 0.2, color)
    addText(slide, title, { x: x + 0.5, y: y + 0.28, w: 1.25, h: 0.12, fontSize: 9.5, bold: true })
    addText(slide, sub, { x: x + 0.5, y: y + 0.58, w: 1.25, h: 0.12, fontSize: 7.2, color: C.muted })
  })
}

function visualSurfaces(slide) {
  const surfaces = [
    ['dashboard', 6.75, 1.3],
    ['CLI', 9.55, 1.3],
    ['SDK', 6.75, 4.15],
    ['MCP', 9.55, 4.15],
  ]
  surfaces.forEach(([text, x, y]) => {
    card(slide, x, y, 1.75, 0.82, C.card, C.line)
    addText(slide, text, { x, y: y + 0.34, w: 1.75, h: 0.12, fontSize: 10, bold: true, align: 'center' })
    line(slide, x + 0.88, y + 0.82, 8.65, 3.45, C.line, 1.2)
  })
  card(slide, 7.67, 3.05, 1.95, 0.78, 'F5F0E8', C.ink)
  addText(slide, 'same wallets', { x: 7.67, y: 3.37, w: 1.95, h: 0.12, fontSize: 9.5, bold: true, align: 'center' })
}

function visualBase(slide) {
  card(slide, 6.6, 4.65, 4.95, 0.7, C.ink, C.ink)
  addText(slide, 'Agentis', { x: 6.6, y: 4.93, w: 4.95, h: 0.12, fontSize: 11, bold: true, color: 'FFFFFF', align: 'center' })
  const apps = ['research agents', 'paid APIs', 'DeFi agents', 'private agents']
  apps.forEach((app, i) => {
    const x = 6.75 + i * 1.2
    const y = 2.55 - (i % 2) * 0.45
    card(slide, x, y, 1.02, 0.82, C.card, C.line)
    line(slide, x + 0.51, y + 0.82, 9.07, 4.65, C.line, 1.2)
    addText(slide, app, { x: x + 0.1, y: y + 0.29, w: 0.82, h: 0.2, fontSize: 6.5, bold: true, align: 'center', fit: 'shrink' })
  })
}

const visuals = {
  title: visualTitle,
  orbit: visualOrbit,
  spenders: visualSpenders,
  five: visualFive,
  tangle: visualTangle,
  hub: visualHub,
  flows: visualFlows,
  surfaces: visualSurfaces,
  base: visualBase,
}

slides.forEach((item, index) => {
  const slide = pptx.addSlide()
  slide.background = { color: C.bg }
  if (item.visual !== 'title') {
    addKicker(slide, item.title)
    addSentence(slide, item.sentence)
  }
  visuals[item.visual](slide)
  addFooter(slide, index)
  if (typeof slide.addNotes === 'function') slide.addNotes(item.note)
})

await pptx.writeFile({ fileName: out })
console.log(out)
