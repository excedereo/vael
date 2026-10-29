import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  Folder2, Document, DocumentText1, SearchNormal1, CloseCircle, ArrowLeft2,
} from 'iconsax-reactjs'
import { api, type MemoryNode } from '../lib/api.js'
import { cn } from '../lib/utils.js'
import { t } from '../lib/i18n.js'

// Граф памяти. Два жеста для двух задач:
//   зум  — осмотреться: чем ближе, тем глубже видна вложенность (LOD)
//   клик — углубиться: папка встаёт в центр, содержимое кругом
//
// Раскладка детерминированная (радиальное дерево от индекса), а не силовая:
// силовая каждый раз даёт другую картинку, а память узнают «по месту».
//
// Анимация не идёт через React: ререндер каждый кадр давал заметную дрожь.
// Покачивание — CSS-анимация на узле, линии двигаются прямой записью в DOM
// по заранее собранным ссылкам (querySelector каждый кадр был слишком дорог).

interface Props {
  root?: string
}

interface Placed {
  node: MemoryNode
  x: number
  y: number
  r: number
  depth: number
  parent: string | null
  dur: number
  delay: number
  amp: number
  /** свёрнутая группа: сколько узлов за этой «стопкой» */
  stack?: number
  /** что свёрнуто — папки или файлы */
  stackKind?: 'dir' | 'file'
  /** родитель текущего уровня, нарисованный тенью сверху */
  ghost?: boolean
}

const ROOT_ID = '__root__'

/** Больше этого числа файлов — сворачиваем их в стопку. */
const INLINE_MAX = 5

/**
 * Папок больше этого числа — тоже сворачиваем, иначе кольцо превращается
 * в сплошную гусеницу (archive/acts — 12 папок по датам).
 * Порог выше файлового: папки важнее, их дольше держим раскрытыми.
 */
const DIR_MAX = 8

/**
 * Раскладывает детей уровня: папки и файлы отдельно, каждая группа
 * сворачивается в стопку при переполнении. Папки идут первыми — структура
 * важнее содержимого.
 */
function makeSpokes(
  items: MemoryNode[],
  ownerRel: string,
  expanded: boolean,
): { node: MemoryNode; stack?: number; stackKind?: 'dir' | 'file' }[] {
  const dirs = items.filter(n => n.type === 'dir')
  const files = items.filter(n => n.type === 'file')
  const out: { node: MemoryNode; stack?: number; stackKind?: 'dir' | 'file' }[] = []

  if (dirs.length <= DIR_MAX || expanded) {
    for (const d of dirs) out.push({ node: d })
  } else if (dirs.length) {
    out.push({
      node: { ...dirs[0], name: t("папки", "folders"), rel: `${ownerRel}::dirs`, children: dirs },
      stack: dirs.length,
      stackKind: 'dir',
    })
  }

  if (files.length <= INLINE_MAX || expanded) {
    for (const f of files) out.push({ node: f })
  } else if (files.length) {
    out.push({
      node: { ...files[0], name: t("файлы", "files"), rel: `${ownerRel}::files`, children: files },
      stack: files.length,
      stackKind: 'file',
    })
  }

  return out
}

const BRANCH_HUE: Record<string, number> = {
  me: 190, us: 340, body: 20, world: 265, how: 150, now: 45, archive: 220,
}
// У стопки rel синтетический («how::files») — оттенок берём по её владельцу,
// иначе она красится чужим цветом посреди своей ветки
const hueFor = (rel: string) => BRANCH_HUE[rel.replace(/::(files|dirs)$/, '').split('/')[0]] ?? 200

/** Размеры почти не падают с глубиной — мелочь не должна превращаться в горошины. */
function radiusFor(n: MemoryNode, depth: number): number {
  if (depth === 0) return 32
  if (n.type === 'dir') return depth === 1 ? 26 : depth === 2 ? 23 : 21
  const kb = (n.size ?? 0) / 1024
  const base = Math.max(16, Math.min(23, 16 + kb * 1.2))
  return depth >= 3 ? base * 0.92 : base
}

/**
 * Сколько букв показываем в подписи. Отдалились — имена мешают друг другу,
 * приблизились — есть место на полное. Под курсором всегда целиком.
 */
function labelLimitFor(k: number): number {
  if (k < 0.6) return 6
  if (k < 1.1) return 9
  if (k < 1.8) return 14
  return 99
}

function trimLabel(name: string, limit: number): string {
  const clean = name.replace(/\.md$/, '')
  if (clean.length <= limit) return clean
  // дата вида 2026-08-27 читается по хвосту, а не по началу
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) return clean.slice(5)
  return clean.slice(0, limit - 1) + '…'
}

/**
 * Сколько места занимает узел по дуге — вместе с подписью, а не только кружок.
 * Именно подписи налезают друг на друга первыми.
 */
function slotWidth(n: MemoryNode, r: number, labelLimit: number): number {
  const label = trimLabel(n.name, labelLimit)
  // ~5.6px на символ при 11px шрифте
  return Math.max(r * 2 + 14, label.length * 5.6 + 10)
}

/**
 * Раскладка детей по дуге: угол и радиус подбираются так, чтобы каждому
 * хватило места под подпись. Раньше был фиксированный радиус и шаг «по
 * 0.16 рад на узел» с потолком — при длинных именах подписи слипались.
 */
function arcFor(
  slots: number[],
  baseR: number,
  maxSpread: number,
): { radius: number; step: number; spread: number } {
  const total = slots.reduce((a, b) => a + b, 0)
  if (slots.length <= 1) return { radius: baseR, step: 0, spread: 0 }
  // длина дуги, нужная чтобы всё влезло → отсюда минимальный радиус
  const needed = total / maxSpread
  const radius = Math.max(baseR, needed)
  const spread = Math.min(maxSpread, total / radius)
  return { radius, step: spread / (slots.length - 1), spread }
}

/** До какой глубины рисуем при данном масштабе. */
function depthLimitFor(k: number): number {
  if (k < 0.6) return 1
  if (k < 1.1) return 2
  if (k < 1.8) return 3
  return 99
}

export function MemoryGraph(_props: Props) {
  const [nodes, setNodes] = useState<MemoryNode[]>([])
  const [root, setRoot] = useState('')
  const [hover, setHover] = useState<string | null>(null)

  /** путь погружения: [] — корень памяти */
  const [trail, setTrail] = useState<string[]>([])
  /** узлы, чьи стопки раскрыты на месте (клик по стопке своего же уровня) */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [cam, setCam] = useState({ x: 0, y: 0, k: 1 })
  const dragRef = useRef<{ sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)

  const [openRel, setOpenRel] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const [search, setSearch] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 1000, h: 680 })

  useEffect(() => {
    api.memoryTree().then(r => {
      if (r.ok) { setNodes(r.nodes); setRoot(r.root) }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    // Нулевые размеры игнорируем: при первом показе панели контейнер ещё не
    // разложен, и центр графа считался бы по старым числам — узел уезжал
    // из середины, и это чинилось само только при следующем ресайзе
    const apply = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w > 0 && h > 0) setSize({ w, h })
    }
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    apply()
    // Подстраховка на первый кадр: ResizeObserver иногда срабатывает уже
    // после того, как мы посчитали раскладку
    const raf = requestAnimationFrame(apply)
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [])

  const openFile = useCallback(async (rel: string) => {
    if (!root) return
    setOpenRel(rel)
    setDirty(false)
    const r = await api.memoryReadFile(`${root}\\${rel.split('/').join('\\')}`)
    setText(r.ok ? r.content : '')
  }, [root])

  const save = useCallback(async () => {
    if (!openRel || !root) return
    setSaving(true)
    await api.memoryWriteFile(`${root}\\${openRel.split('/').join('\\')}`, text)
    setSaving(false)
    setDirty(false)
    api.memoryTree().then(r => { if (r.ok) setNodes(r.nodes) }).catch(() => {})
  }, [openRel, root, text])

  const findNode = useCallback((rel: string): MemoryNode | null => {
    const walk = (list: MemoryNode[]): MemoryNode | null => {
      for (const n of list) {
        if (n.rel === rel) return n
        if (n.children) { const f = walk(n.children); if (f) return f }
      }
      return null
    }
    return walk(nodes)
  }, [nodes])

  /**
   * Провалиться в папку: она станет центром нового уровня.
   *
   * `openStack` — когда ныряем по клику на стопку: пользователь уже попросил
   * показать её содержимое, и встречать его там той же нераскрытой стопкой
   * (клик впустую) нельзя.
   */
  const dive = useCallback((rel: string, openStack = false) => {
    setTrail(t => [...t, rel])
    setCam({ x: 0, y: 0, k: 1 })
    setHover(null)
    // Раскрытые стопки — состояние конкретного вида, при переходе сбрасываем:
    // иначе вернувшись на главную видишь её уже раскрытой
    setExpanded(openStack ? new Set([rel]) : new Set())
  }, [])

  const surface = useCallback((level: number) => {
    setTrail(t => t.slice(0, level))
    setCam({ x: 0, y: 0, k: 1 })
    setHover(null)
    setExpanded(new Set())
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F3' || ((e.ctrlKey || e.metaKey) && e.key === 'f')) {
        e.preventDefault()
        setSearch(s => (s === null ? '' : s))
        setTimeout(() => searchRef.current?.focus(), 30)
      }
      if (e.key === 'Escape') {
        if (search !== null) setSearch(null)
        else if (openRel) setOpenRel(null)
        else if (trail.length) surface(trail.length - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [search, openRel, trail, surface])

  // Что показываем на текущем уровне
  const level = useMemo(() => {
    if (!trail.length) {
      const center = nodes.find(n => n.type === 'file' && /^(MEMORY|INDEX)\.md$/i.test(n.name))
      return {
        center: center ?? { name: 'memory', rel: ROOT_ID, type: 'dir' as const },
        items: nodes.filter(n => n !== center),
        ghost: null as MemoryNode | null,
      }
    }
    const cur = findNode(trail[trail.length - 1])
    const parentRel = trail.length > 1 ? trail[trail.length - 2] : null
    return {
      center: cur ?? { name: '?', rel: ROOT_ID, type: 'dir' as const },
      items: cur?.children ?? [],
      ghost: parentRel ? findNode(parentRel) : (nodes.length ? { name: 'memory', rel: ROOT_ID, type: 'dir' } as MemoryNode : null),
    }
  }, [trail, nodes, findNode])

  const depthLimit = depthLimitFor(cam.k)
  const labelLimit = labelLimitFor(cam.k)

  const placed = useMemo<Placed[]>(() => {
    if (!nodes.length) return []
    const cx = size.w / 2
    const cy = size.h / 2
    const out: Placed[] = []

    // Родитель уровня — бледной тенью сверху, чтобы было видно откуда пришли
    if (level.ghost) {
      out.push({
        // Выше кольца и мельче центра: иначе глаз принимает призрак
        // за центральный узел уровня
        node: level.ghost, x: cx, y: cy - Math.min(size.w, size.h) * 0.46,
        r: 13, depth: -1, parent: null, dur: 13, delay: 0, amp: 2, ghost: true,
      })
    }

    out.push({
      node: level.center, x: cx, y: cy, r: 30, depth: 0, parent: null,
      dur: 11, delay: 0, amp: 3,
    })

    const centerRel = level.center.rel
    const spokes = makeSpokes(level.items, centerRel, expanded.has(centerRel))

    // Малому кольцу большой радиус не нужен — два узла на 31% экрана выглядят
    // как два случайных пятна вместо грозди вокруг центра
    const baseRing = Math.min(size.w, size.h) * (spokes.length <= 2 ? 0.2 : spokes.length <= 4 ? 0.26 : 0.31)
    // Полное кольцо: длина окружности должна вместить все слоты с подписями
    const ringSlots = spokes.map(sp => slotWidth(sp.node, radiusFor(sp.node, 1), labelLimit))
    const ringNeed = ringSlots.reduce((a, b) => a + b, 0) / (Math.PI * 2)
    const ringR = Math.max(baseRing, ringNeed)

    // Каждой ветке — свой угловой сектор, пропорциональный её размеру.
    // Раньше спицы стояли через равный угол, а дети раздвигались вширь по
    // радиусу — и густая ветка залезала в соседнюю (archive перемешивался
    // с body). Секторы не пересекаются по построению.
    //
    // Пропорция с потолком: чистая пропорция отдала бы archive половину круга,
    // а world с одним файлом превратился бы в тонкий клин.
    const weights = spokes.map(sp => {
      // Стопка занимает место одного узла, но за ней много содержимого —
      // даём ей чуть больше веса, чем обычной спице, но не как всей пачке
      if (sp.stack) return 1 + Math.min(sp.stack, 12) * 0.14
      // Вес ветки — по тому, сколько спиц реально появится у её детей после
      // группировки: 8 файлов схлопнутся в одну стопку и места займут мало
      const kids = sp.node.children ?? []
      const kDirs = kids.filter(k => k.type === 'dir').length
      const kFiles = kids.filter(k => k.type === 'file').length
      const shown = (kDirs <= DIR_MAX ? kDirs : 1) + (kFiles <= INLINE_MAX ? kFiles : 1)
      return 1 + Math.min(shown, 10) * 0.55
    })
    const wTotal = weights.reduce((a, b) => a + b, 0)
    const MAX_SECTOR = Math.PI * 2 * 0.42
    const sectors = weights.map(w => Math.min((w / wTotal) * Math.PI * 2, MAX_SECTOR))
    // потолок мог отнять угол — раздаём остаток поровну
    const slack = Math.PI * 2 - sectors.reduce((a, b) => a + b, 0)
    if (slack > 0.001) for (let i = 0; i < sectors.length; i++) sectors[i] += slack / sectors.length

    // Смещение фиксированное, а не доля шага: при двух-трёх узлах шаг огромный,
    // и «лёгкий поворот кольца» превращался в перекос на 40–60°, из-за чего
    // единственная спица уезжала вбок и центр выглядел смещённым
    const a0 = -Math.PI / 2 + (spokes.length > 4 ? 0.16 : 0)

    let acc = a0
    spokes.forEach((sp, i) => {
      const n = sp.node
      const sector = sectors[i]
      // узел — в середине своего сектора
      const a = acc + sector / 2
      acc += sector
      const x = cx + Math.cos(a) * ringR
      const y = cy + Math.sin(a) * ringR
      out.push({
        node: n, x, y, r: radiusFor(n, 1), depth: 1,
        parent: level.center.rel,
        dur: 7 + (i % 4) * 1.3, delay: i * 0.45, amp: 5,
        stack: sp.stack,
        stackKind: sp.stackKind,
      })

      if (sp.stack || depthLimit < 2) return

      const kids = n.children ?? []
      if (!kids.length) return

      const kSpokes = makeSpokes(kids, n.rel, expanded.has(n.rel))

      const kSlots = kSpokes.map(ks => slotWidth(ks.node, radiusFor(ks.node, 2), labelLimit))
      // Не шире своего сектора (с небольшим запасом внутрь), иначе ветка
      // перекроет соседнюю. Не влезло по углу — arcFor раздвинет радиус.
      const kArc = arcFor(kSlots, ringR * 0.52, Math.max(0.5, sector * 0.82))
      const spread = kArc.spread
      const kidR = kArc.radius
      const kstep = kArc.step

      kSpokes.forEach((ks, j) => {
        const k = ks.node
        const ka = a - spread / 2 + kstep * j
        const kx = x + Math.cos(ka) * kidR
        const ky = y + Math.sin(ka) * kidR
        out.push({
          node: k, x: kx, y: ky, r: radiusFor(k, 2), depth: 2, parent: n.rel,
          dur: 6 + (j % 5) * 1.1, delay: i * 0.3 + j * 0.25, amp: 6,
          stack: ks.stack,
          stackKind: ks.stackKind,
        })

        if (ks.stack || depthLimit < 3) return
        const sub = k.children ?? []
        if (!sub.length) return
        // Через makeSpokes, как и верхние уровни: прямая раскладка тут
        // обходила группировку, и 24 дня разъезжались гусеницей
        const sSpokes = makeSpokes(sub, k.rel, expanded.has(k.rel))
        const sSlots = sSpokes.map(ss => slotWidth(ss.node, radiusFor(ss.node, 3), labelLimit))
        // Третий уровень тоже держим в границах сектора ветки
        const sArc = arcFor(sSlots, kidR * 0.62, Math.max(0.4, sector * 0.5))
        const sSpread = sArc.spread
        const sR = sArc.radius
        const sStep = sArc.step
        sSpokes.forEach((ss, q) => {
          const sa = ka - sSpread / 2 + sStep * q
          out.push({
            node: ss.node, x: kx + Math.cos(sa) * sR, y: ky + Math.sin(sa) * sR,
            r: radiusFor(ss.node, 3), depth: 3, parent: k.rel,
            dur: 5.5 + (q % 4) * 1.2, delay: j * 0.2 + q * 0.3, amp: 5,
            stack: ss.stack, stackKind: ss.stackKind,
          })
        })
      })
    })

    return out
  }, [nodes, size, level, depthLimit, expanded])

  const byRel = useMemo(() => {
    const m = new Map<string, Placed>()
    for (const p of placed) m.set(p.node.rel, p)
    return m
  }, [placed])

  // Отсечение по видимой области: при зуме отбрасывает почти всё
  const visible = useMemo(() => {
    const pad = 120
    return placed.filter(p => {
      const sx = p.x * cam.k + cam.x
      const sy = p.y * cam.k + cam.y
      return sx > -pad && sx < size.w + pad && sy > -pad && sy < size.h + pad
    })
  }, [placed, cam, size])

  const pathToRoot = useMemo(() => {
    const set = new Set<string>()
    let cur = hover
    while (cur) { set.add(cur); cur = byRel.get(cur)?.parent ?? null }
    return set
  }, [hover, byRel])

  const matched = useMemo(() => {
    if (!search) return null
    const q = search.toLowerCase()
    return new Set(placed.filter(p => p.node.rel.toLowerCase().includes(q)).map(p => p.node.rel))
  }, [search, placed])

  // Покачивание при мелком масштабе не читается — гасим вместе с работой в rAF
  const animate = cam.k >= 0.6

  // Ссылки на линии собираем один раз на перестроение, а не ищем каждый кадр
  const lineRefs = useRef<{ el: SVGPathElement; p: Placed; par: Placed }[]>([])
  useEffect(() => {
    if (!svgRef.current) return
    const svg = svgRef.current
    lineRefs.current = []
    for (const p of visible) {
      if (!p.parent) continue
      const par = byRel.get(p.parent)
      if (!par) continue
      const el = svg.querySelector<SVGPathElement>(`[data-l="${CSS.escape(p.node.rel)}"]`)
      if (el) lineRefs.current.push({ el, p, par })
    }
  }, [visible, byRel])

  useEffect(() => {
    if (!animate) {
      for (const { el, p, par } of lineRefs.current) {
        el.setAttribute('d', `M ${par.x} ${par.y} L ${p.x} ${p.y}`)
      }
      return
    }
    let raf = 0
    const tick = () => {
      const t = performance.now() / 1000
      const off = (p: Placed) => {
        const ph = (t / p.dur + p.delay) * Math.PI * 2
        return { dx: Math.sin(ph * 0.5) * p.amp * 0.3, dy: Math.sin(ph) * p.amp }
      }
      for (const { el, p, par } of lineRefs.current) {
        const a = off(p), b = off(par)
        el.setAttribute('d', `M ${par.x + b.dx} ${par.y + b.dy} L ${p.x + a.dx} ${p.y + a.dy}`)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animate, visible])

  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false }
    setDragging(true)
  }
  useEffect(() => {
    if (!dragging) return
    const move = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      if (Math.abs(e.clientX - d.sx) > 3 || Math.abs(e.clientY - d.sy) > 3) d.moved = true
      setCam(c => ({ ...c, x: d.cx + (e.clientX - d.sx), y: d.cy + (e.clientY - d.sy) }))
    }
    const up = () => { setDragging(false); setTimeout(() => { dragRef.current = null }, 0) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [dragging])

  const onWheel = (e: React.WheelEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    setCam(c => {
      const k = Math.min(3, Math.max(0.3, c.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
      const s = k / c.k
      return { k, x: mx - (mx - c.x) * s, y: my - (my - c.y) * s }
    })
  }

  const hoveredNode = hover ? byRel.get(hover) : null

  const crumbs = useMemo(() => {
    const out = [{ label: t("память", "memory"), level: 0 }]
    trail.forEach((rel, i) => out.push({ label: rel.split('/').pop() ?? rel, level: i + 1 }))
    return out
  }, [trail])

  return (
    <div
      ref={wrapRef}
      onMouseDown={onDown}
      onWheel={onWheel}
      className="relative flex-1 overflow-hidden select-none"
      style={{ background: '#000', cursor: dragging ? 'grabbing' : 'grab' }}
    >
      <Starfield w={size.w} h={size.h} cam={cam} />

      <div
        className="absolute inset-0 origin-top-left"
        style={{
          transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`,
          transition: dragging ? 'none' : 'transform 110ms linear',
        }}
      >
        <svg ref={svgRef} width={size.w} height={size.h} className="absolute inset-0 pointer-events-none overflow-visible">
          {visible.map(p => {
            if (!p.parent) return null
            const par = byRel.get(p.parent)
            if (!par) return null
            const onPath = hover != null && pathToRoot.has(p.node.rel)
            const dim = hover != null && !onPath
            const hue = hueFor(p.node.rel)
            return (
              <path
                key={'l' + p.node.rel}
                data-l={p.node.rel}
                d={`M ${par.x} ${par.y} L ${p.x} ${p.y}`}
                fill="none"
                stroke={`hsl(${hue} 55% ${onPath ? 62 : 40}%)`}
                strokeWidth={onPath ? 1.5 : 0.8}
                opacity={dim ? 0.05 : onPath ? 0.75 : 0.2}
                style={{ transition: 'opacity 240ms ease, stroke-width 240ms ease' }}
              />
            )
          })}
        </svg>

        {visible.map(p => {
          const hue = hueFor(p.node.rel)
          const isHover = hover === p.node.rel
          const onPath = hover != null && pathToRoot.has(p.node.rel)
          const isMatch = matched?.has(p.node.rel)
          const dim = (hover != null && !onPath) || (matched != null && !isMatch)
          const isDir = p.node.type === 'dir'
          const isStack = !!p.stack
          const notLoaded = p.node.type === 'file' && !isStack && p.node.loaded === false
          const isRoot = p.depth === 0
          const ic = Math.max(11, Math.round(p.r * 0.9))

          if (p.ghost) {
            return (
              <div
                key="ghost"
                onClick={e => { e.stopPropagation(); surface(trail.length - 1) }}
                className="absolute cursor-pointer flex flex-col items-center"
                style={{ left: p.x - p.r, top: p.y - p.r, width: p.r * 2, zIndex: 5, opacity: 0.3 }}
              >
                <div
                  className="rounded-full flex items-center justify-center"
                  style={{
                    width: p.r * 2, height: p.r * 2,
                    border: '1px dashed rgba(255,255,255,.3)',
                    background: 'rgba(255,255,255,.03)',
                  }}
                >
                  <Folder2 size={ic} variant="Linear" color="rgba(255,255,255,.5)" />
                </div>
                <div className="text-[10.5px] text-white/40 mt-1 whitespace-nowrap">
                  ↑ {p.node.name}
                </div>
              </div>
            )
          }

          return (
            <div
              key={p.node.rel}
              onMouseEnter={() => setHover(p.node.rel)}
              onMouseLeave={() => setHover(h => (h === p.node.rel ? null : h))}
              onClick={e => {
                e.stopPropagation()
                if (dragRef.current?.moved) return
                if (isStack) {
                  // Стопка принадлежит своему владельцу. Если он не в центре —
                  // ныряем к нему (там места больше). Если уже в центре —
                  // раскрываем на месте, иначе получилось бы «days / days».
                  const owner = p.node.rel.replace(/::(files|dirs)$/, '')
                  if (owner !== level.center.rel) dive(owner, true)
                  else setExpanded(s => {
                    const n = new Set(s)
                    if (n.has(owner)) n.delete(owner); else n.add(owner)
                    return n
                  })
                } else if (isDir) {
                  dive(p.node.rel)
                } else if (!isRoot || p.node.type === 'file') {
                  openFile(p.node.rel)
                }
              }}
              className="absolute"
              style={{
                left: p.x - p.r,
                top: p.y - p.r,
                width: p.r * 2,
                height: p.r * 2,
                zIndex: isHover ? 30 : isRoot ? 20 : 10,
                animation: animate ? `vgFloat ${p.dur}s ease-in-out ${p.delay}s infinite` : undefined,
                ['--vg-amp' as string]: `${p.amp}px`,
              }}
            >
              {/* «стопка» — один лист за основным кругом, намёк на пачку */}
              {isStack && (
                <span className="absolute rounded-full" style={{
                  inset: 0, transform: 'translate(3px,3px)',
                  background: `hsl(${hue} 30% 11%)`, border: `1px solid hsl(${hue} 35% 32% / .45)`,
                }} />
              )}

              <div
                className="relative w-full h-full rounded-full flex items-center justify-center cursor-pointer"
                style={{
                  // База заметно светлее, чем была: при 14–17% узлы читались
                  // как выключенные, и казалось, что они «оживают» лишь под курсором
                  background: isDir || isStack
                    ? `hsl(${hue} 40% ${isHover ? 32 : 25}%)`
                    : `hsl(${hue} 32% ${isHover ? 28 : 21}%)`,
                  border: `1px ${notLoaded ? 'dashed' : 'solid'} hsl(${hue} ${isHover ? 62 : 48}% ${isHover ? 66 : 55}% / ${notLoaded ? 0.45 : 0.85})`,
                  boxShadow: isHover ? `0 0 14px 1px hsl(${hue} 70% 50% / .3)` : 'none',
                  opacity: dim ? 0.28 : notLoaded ? 0.72 : 1,
                  transform: isHover ? 'scale(1.16) rotate(4deg)' : 'scale(1)',
                  transition: 'transform 200ms cubic-bezier(.2,.9,.3,1.15), opacity 240ms ease, box-shadow 240ms ease',
                }}
              >
                {isStack ? (
                  p.stackKind === 'dir'
                    ? <Folder2 size={ic} variant={isHover ? 'Bold' : 'Linear'} color={`hsl(${hue} 62% 72%)`} />
                    : <Document size={ic} variant={isHover ? 'Bold' : 'Linear'} color={`hsl(${hue} 55% 70%)`} />
                ) : isDir ? (
                  <Folder2 size={ic} variant={isHover ? 'Bold' : 'Linear'} color={`hsl(${hue} 65% 72%)`} />
                ) : isRoot ? (
                  <DocumentText1 size={ic} variant="Bold" color={`hsl(${hue} 65% 75%)`} />
                ) : (
                  <Document size={ic} variant={isHover ? 'Bold' : 'Linear'} color={`hsl(${hue} 55% 68%)`} />
                )}
              </div>

              {/* счётчик — бейджем в углу, а не вместо иконки:
                  так видно и что это файлы, и сколько их */}
              {isStack && (
                <span
                  className="absolute rounded-full flex items-center justify-center tabular-nums pointer-events-none"
                  style={{
                    right: -5,
                    top: -5,
                    minWidth: 15,
                    height: 15,
                    padding: '0 3.5px',
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: '#05060a',
                    background: `hsl(${hue} 62% 66%)`,
                    boxShadow: '0 0 0 2px #000',
                  }}
                >
                  {p.stack}
                </span>
              )}

              {/* Глубокие уровни подписываем, когда приблизились: иначе имена
                  налезают друг на друга на общем виде */}
              {(p.depth <= 1 || cam.k >= 1.1 || isHover || isMatch) && (
                <div
                  className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none"
                  style={{
                    top: p.r * 2 + 5,
                    fontSize: isRoot ? 12.5 : 11,
                    color: isHover || isMatch ? `hsl(${hue} 70% 80%)` : 'rgba(214,221,233,.72)',
                    textShadow: '0 1px 5px #000, 0 0 3px #000',
                    fontWeight: isRoot ? 600 : 400,
                    opacity: dim ? 0.3 : 1,
                  }}
                >
                  {isStack
                    ? t("файлы", "files")
                    : isHover
                      ? p.node.name.replace(/\.md$/, '')
                      : trimLabel(p.node.name, labelLimit)}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Хлебные крошки */}
      <div className="absolute top-4 left-4 flex items-center gap-1 text-[12px]" style={{ zIndex: 60 }}>
        {crumbs.map((c, i) => (
          <span key={c.level} className="flex items-center gap-1">
            {i > 0 && <span className="text-white/20">/</span>}
            <button
              onClick={() => surface(c.level)}
              className={cn(
                'px-1.5 py-0.5 rounded transition-colors',
                i === crumbs.length - 1
                  ? 'text-white/80 cursor-default'
                  : 'text-white/40 hover:text-white/80 hover:bg-white/8',
              )}
            >
              {c.label}
            </button>
          </span>
        ))}
        {trail.length > 0 && (
          <button
            onClick={() => surface(trail.length - 1)}
            title={t("Назад (Esc)", "Back (Esc)")}
            className="ml-1 w-6 h-6 rounded flex items-center justify-center text-white/40 hover:text-white/85 hover:bg-white/8 transition-colors"
          >
            <ArrowLeft2 size={14} variant="Linear" color="currentColor" />
          </button>
        )}
      </div>

      {hoveredNode?.node.children?.length && !hoveredNode.stack ? (
        <div
          className="absolute pointer-events-none rounded-xl px-3 py-2"
          style={{
            left: Math.min(hoveredNode.x * cam.k + cam.x + hoveredNode.r * cam.k + 14, size.w - 210),
            top: Math.max(8, Math.min(hoveredNode.y * cam.k + cam.y - 40, size.h - 190)),
            width: 195,
            background: 'rgba(6,7,11,.95)',
            border: '1px solid rgba(255,255,255,.1)',
            zIndex: 60,
          }}
        >
          <div className="text-[11px] text-white/40 mb-1">{hoveredNode.node.children.length} {t("внутри", "inside")}</div>
          {hoveredNode.node.children.slice(0, 9).map(c => (
            <div key={c.rel} className="text-[11.5px] text-white/75 truncate leading-[1.5] flex items-center gap-1.5">
              {c.type === 'dir'
                ? <Folder2 size={11} variant="Bold" color="rgba(255,255,255,.45)" />
                : <Document size={11} variant="Linear" color="rgba(255,255,255,.35)" />}
              {c.name.replace(/\.md$/, '')}
            </div>
          ))}
          {hoveredNode.node.children.length > 9 && (
            <div className="text-[11px] text-white/30 mt-0.5">{t("…ещё", "…more")}{' '}{hoveredNode.node.children.length - 9}</div>
          )}
        </div>
      ) : null}

      {search !== null && (
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ background: 'rgba(8,9,14,.96)', border: '1px solid rgba(255,255,255,.12)', zIndex: 70 }}
        >
          <SearchNormal1 size={14} variant="Linear" color="rgba(255,255,255,.45)" />
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("имя файла или папки", "file or folder name")}
            className="bg-transparent outline-none text-[12.5px] text-white/85 placeholder:text-white/25 w-52"
          />
          <span className="text-[11px] text-white/35 tabular-nums">{matched ? matched.size : 0}</span>
          <button onClick={() => setSearch(null)} className="text-white/35 hover:text-white/80 transition-colors">
            <CloseCircle size={15} variant="Linear" color="currentColor" />
          </button>
        </div>
      )}

      <div className="absolute bottom-4 right-4 flex items-center gap-1.5" style={{ zIndex: 50 }}>
        <button
          onClick={() => setCam({ x: 0, y: 0, k: 1 })}
          className="px-2.5 py-1 rounded-lg text-[11.5px] bg-white/6 border border-white/10 text-white/55 hover:text-white/90 hover:bg-white/12 transition-colors"
        >
          {t("сброс", "reset")}
        </button>
        <span className="text-[11px] text-white/30 tabular-nums w-10 text-right">{Math.round(cam.k * 100)}%</span>
      </div>

      <div className="absolute bottom-4 left-4 text-[11px] text-white/25 leading-relaxed pointer-events-none">
        <div>{t("тянуть — двигать · колесо — глубина · клик по папке — внутрь", "drag — move · wheel — depth · click a folder — go inside")}</div>
        <div className="opacity-75">{t("пунктир — не грузится · F3 — поиск", "dashed — not loaded · F3 — search")}</div>
      </div>

      {/* Редактор */}
      <div
        className="absolute top-0 right-0 h-full flex flex-col"
        style={{
          width: '42%',
          minWidth: 400,
          transform: openRel ? 'translateX(0)' : 'translateX(103%)',
          transition: 'transform 380ms cubic-bezier(.22,.9,.28,1)',
          background: '#0a0b10',
          borderLeft: '1px solid rgba(255,255,255,.14)',
          boxShadow: '-28px 0 70px rgba(0,0,0,.9)',
          zIndex: 80,
        }}
      >
        {openRel && (
          <>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
              <Document size={15} variant="Bold" color="rgba(255,255,255,.4)" className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-white/88 truncate">
                  {openRel.split('/').pop()?.replace(/\.md$/, '')}
                </div>
                <div className="text-[11px] text-white/35 truncate font-mono">{openRel}</div>
              </div>
              {dirty && (
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-3 py-1.5 rounded-lg text-[12px] shrink-0 bg-accent/85 text-white hover:bg-accent transition-colors"
                >
                  {saving ? t("Сохраняю…", "Saving…") : t("Сохранить", "Save")}
                </button>
              )}
              <button
                onClick={() => { setOpenRel(null); setDirty(false) }}
                title={t("Закрыть (Esc)", "Close (Esc)")}
                className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-white/45 hover:text-white hover:bg-white/12 transition-colors"
              >
                <CloseCircle size={18} variant="Linear" color="currentColor" />
              </button>
            </div>

            <textarea
              value={text}
              onChange={e => { setText(e.target.value); setDirty(true) }}
              onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save() }
              }}
              spellCheck={false}
              className="flex-1 w-full resize-none bg-transparent px-4 py-3 text-[13px] leading-relaxed text-white/85 font-mono outline-none"
            />

            <div className="px-4 py-2 border-t border-white/8 text-[11px] text-white/30 flex justify-between">
              <span>{text.length.toLocaleString('ru')} {t("символов", "characters")}</span>
              <span>{dirty ? t("не сохранено · Ctrl+S", "unsaved · Ctrl+S") : t("сохранено · Esc закрыть", "saved · Esc to close")}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Звёзды в три слоя с параллаксом: дальние почти стоят, ближние едут за
 * камерой. Масштаб слабый (корень из зума) — иначе при 300% они станут
 * кляксами и полезут поверх графа.
 */
function Starfield({ w, h, cam }: { w: number; h: number; cam: { x: number; y: number; k: number } }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const camRef = useRef(cam)
  camRef.current = cam

  useEffect(() => {
    const cv = ref.current
    if (!cv || !w || !h) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    cv.width = w * dpr
    cv.height = h * dpr
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    // поле шире экрана — чтобы при панораме не появлялся пустой край
    const MARGIN = 600
    const layers = [
      { f: 0.12, n: Math.round((w * h) / 16000), r: 0.5, a: 0.16 },
      { f: 0.3, n: Math.round((w * h) / 13000), r: 0.75, a: 0.24 },
      { f: 0.6, n: Math.round((w * h) / 11000), r: 1.0, a: 0.34 },
    ].map(L => ({
      ...L,
      stars: Array.from({ length: L.n }, () => ({
        x: Math.random() * (w + MARGIN * 2) - MARGIN,
        y: Math.random() * (h + MARGIN * 2) - MARGIN,
        ph: Math.random() * Math.PI * 2,
        sp: 0.25 + Math.random() * 0.5,
      })),
    }))

    const span = (v: number, size: number) => {
      // заворачиваем координату в видимую полосу, чтобы поле было бесконечным
      const period = size + MARGIN * 2
      let r = (v + MARGIN) % period
      if (r < 0) r += period
      return r - MARGIN
    }

    let raf = 0
    const draw = () => {
      const t = performance.now() / 1000
      const c = camRef.current
      const zoom = Math.sqrt(c.k)
      ctx.clearRect(0, 0, w, h)
      for (const L of layers) {
        for (const s of L.stars) {
          const x = span(s.x * zoom + c.x * L.f, w)
          const y = span(s.y * zoom + c.y * L.f, h)
          if (x < -4 || x > w + 4 || y < -4 || y > h + 4) continue
          const a = L.a * (0.45 + Math.abs(Math.sin(t * s.sp + s.ph)) * 0.55)
          ctx.beginPath()
          ctx.arc(x, y, L.r * zoom, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(255,255,255,${a})`
          ctx.fill()
        }
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [w, h])

  return <canvas ref={ref} className="absolute inset-0 pointer-events-none" style={{ width: w, height: h }} />
}
