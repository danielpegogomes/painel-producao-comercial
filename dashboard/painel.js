/* Painel de Produção Comercial: filtros, indicadores e gráficos em SVG, sem bibliotecas. */
(() => {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const CORES_CANAL = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)"];
  const $ = (id) => document.getElementById(id);

  let D = null;                       // base exportada pelo pipeline
  const estado = { periodo: "ytd", segmento: "Todos", regional: -1, produto: -1, todasAgencias: false, ordem: { campo: "producao", dir: -1 } };
  const tabelaAtiva = new Set();      // cartões exibindo a visão em tabela

  /* ---------- formatação pt-BR ---------- */
  const nf = (d) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const brl = (v) => {
    const a = Math.abs(v);
    if (a >= 1e9) return `R$ ${nf(2).format(v / 1e9)} bi`;
    if (a >= 1e6) return `R$ ${nf(1).format(v / 1e6)} mi`;
    if (a >= 1e3) return `R$ ${nf(1).format(v / 1e3)} mil`;
    return `R$ ${nf(0).format(v)}`;
  };
  const brlCheio = (v) => `R$ ${nf(0).format(v)}`;
  const eixoBrl = (v) => (v >= 1e9 ? `${nf(1).format(v / 1e9)} bi` : v >= 1e6 ? `${nf(0).format(v / 1e6)} mi` : v >= 1e3 ? `${nf(0).format(v / 1e3)} mil` : nf(0).format(v));
  const pct = (v, d = 1) => `${nf(d).format(v * 100)}%`;
  const pp = (v) => `${v >= 0 ? "+" : "−"}${nf(1).format(Math.abs(v * 100))} p.p.`;
  const variacao = (v) => `${v >= 0 ? "+" : "−"}${nf(1).format(Math.abs(v * 100))}%`;
  const rotuloMes = (m, comAno) => { const [a, mm] = m.split("-"); return MESES_PT[+mm - 1] + (comAno ? `/${a.slice(2)}` : ""); };
  const intervalo = (ms) => (ms.length ? `${rotuloMes(ms[0])}/${ms[0].slice(0, 4)} – ${rotuloMes(ms.at(-1))}/${ms.at(-1).slice(0, 4)}` : "");

  /* ---------- SVG ---------- */
  function el(tag, attrs = {}, pai) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "estilo") Object.assign(n.style, v);
      else if (k === "texto") n.textContent = v;
      else n.setAttribute(k, v);
    }
    if (pai) pai.appendChild(n);
    return n;
  }
  const html = (tag, cls, texto) => { const n = document.createElement(tag); if (cls) n.className = cls; if (texto != null) n.textContent = texto; return n; };

  function ticks(max, n = 4) {
    if (max <= 0) return [0, 1];
    const bruto = max / n, mag = 10 ** Math.floor(Math.log10(bruto));
    const passo = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((p) => p * n >= max) || mag * 10;
    return Array.from({ length: Math.ceil(max / passo) + 1 }, (_, i) => i * passo);
  }
  /* coluna com topo arredondado (4px) e base reta */
  function colunaPath(x, y, w, h, r = 4) {
    if (h <= 0) return "";
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function barraPath(x, y, w, h, r = 4) {
    if (w <= 0) return "";
    r = Math.min(r, w, h / 2);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }

  /* ---------- tooltip (enriquece, nunca é o único caminho para o valor) ---------- */
  const dica = () => $("dica");
  function mostrarDica(ev, titulo, linhas) {
    const d = dica();
    d.replaceChildren();
    d.appendChild(html("div", "dica__titulo", titulo));
    for (const l of linhas) {
      const row = html("div", "dica__linha");
      const k = html("i"); k.style.background = l.cor || "transparent"; if (!l.cor) k.style.height = "0";
      row.append(k, html("span", null, l.rotulo), html("b", null, l.valor));
      d.appendChild(row);
    }
    d.hidden = false;
    const r = d.getBoundingClientRect();
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
    d.style.left = `${Math.max(8, x)}px`; d.style.top = `${Math.max(8, y)}px`;
  }
  const esconderDica = () => { dica().hidden = true; };

  /* ---------- período e filtros ---------- */
  function periodos() {
    const ult = D.meses.at(-1), anoUlt = +ult.slice(0, 4), mesUlt = +ult.slice(5);
    const ms = (pred) => D.meses.map((m, i) => [m, i]).filter(([m]) => pred(m)).map(([, i]) => i);
    const ytd = ms((m) => +m.slice(0, 4) === anoUlt);
    const ytdAnt = ms((m) => +m.slice(0, 4) === anoUlt - 1 && +m.slice(5) <= mesUlt);
    const n = D.meses.length;
    const l12 = [...Array(12)].map((_, i) => n - 12 + i), l12Ant = [...Array(12)].map((_, i) => n - 24 + i).filter((i) => i >= 0);
    const ano = (a) => ms((m) => +m.slice(0, 4) === a);
    return {
      ytd: { rotulo: `${anoUlt} até ${rotuloMes(ult)}`, curto: `${MESES_PT[0]}–${rotuloMes(ult)}/${anoUlt}`, meses: ytd, comp: ytdAnt, compRotulo: `${MESES_PT[0]}–${rotuloMes(ult)}/${anoUlt - 1}` },
      l12m: { rotulo: "Últimos 12 meses", curto: intervalo(l12.map((i) => D.meses[i])), meses: l12, comp: l12Ant.length === 12 ? l12Ant : [], compRotulo: "12 meses anteriores" },
      [String(anoUlt - 1)]: { rotulo: String(anoUlt - 1), curto: String(anoUlt - 1), meses: ano(anoUlt - 1), comp: ano(anoUlt - 2), compRotulo: String(anoUlt - 2) },
      [String(anoUlt - 2)]: { rotulo: String(anoUlt - 2), curto: String(anoUlt - 2), meses: ano(anoUlt - 2), comp: [], compRotulo: "" },
    };
  }
  let P = null;
  const passaProduto = (p) => (estado.produto < 0 || estado.produto === p) && (estado.segmento === "Todos" || D.produtos[p].segmento === estado.segmento);
  const passaRegional = (r) => estado.regional < 0 || estado.regional === r;

  function somar(meses, filtroRegional = true) {
    const set = new Set(meses);
    const t = { producao: 0, contratos: 0, digital: 0, meta: 0 };
    for (const [m, r, p, v, c, dg, mt] of D.producao) {
      if (!set.has(m) || !passaProduto(p) || (filtroRegional && !passaRegional(r))) continue;
      t.producao += v; t.contratos += c; t.digital += dg; t.meta += mt;
    }
    return t;
  }
  function porMes(meses) {
    const idx = new Map(meses.map((m, i) => [m, i]));
    const out = meses.map(() => ({ producao: 0, meta: 0, digital: 0, contratos: 0 }));
    for (const [m, r, p, v, c, dg, mt] of D.producao) {
      const i = idx.get(m);
      if (i === undefined || !passaProduto(p) || !passaRegional(r)) continue;
      out[i].producao += v; out[i].meta += mt; out[i].digital += dg; out[i].contratos += c;
    }
    return out;
  }

  /* ---------- KPIs ---------- */
  function delta(elId, atual, anterior, rotuloComp, tipo = "pct") {
    const alvo = $(elId); alvo.replaceChildren();
    if (!anterior) { alvo.appendChild(html("span", null, "Sem período anterior na base")); return; }
    const v = tipo === "pp" ? atual - anterior : atual / anterior - 1;
    const sobe = v >= 0;
    const b = html("b", sobe ? "sobe" : "desce", `${sobe ? "▲" : "▼"} ${tipo === "pp" ? pp(v) : variacao(v)}`);
    alvo.append(b, html("span", null, `vs. ${rotuloComp}`));
  }

  function renderKpis() {
    const t = somar(P.meses), c = P.comp.length ? somar(P.comp) : null;
    $("k-producao").textContent = brl(t.producao);
    delta("k-producao-delta", t.producao, c && c.producao, P.compRotulo);
    $("k-producao-nota").textContent = `${P.curto} · meta de ${brl(t.meta)}`;

    const at = t.meta ? t.producao / t.meta : 0;
    $("k-atingimento").textContent = pct(at);
    const escala = 1.2;
    $("k-atingimento-barra").style.width = `${Math.min(at / escala, 1) * 100}%`;
    $("k-atingimento-barra").style.background = at >= 1 ? "var(--bom)" : at >= 0.9 ? "var(--s1)" : "var(--critico)";
    document.querySelector(".kpi .medidor i").style.left = `${(1 / escala) * 100}%`;
    const gap = t.producao - t.meta;
    $("k-atingimento-nota").textContent = gap >= 0 ? `${brl(gap)} acima da meta` : `Faltam ${brl(-gap)} para a meta`;

    $("k-contratos").textContent = nf(0).format(t.contratos);
    delta("k-contratos-delta", t.contratos, c && c.contratos, P.compRotulo);
    $("k-ticket").textContent = brlCheio(t.contratos ? t.producao / t.contratos : 0);
    delta("k-ticket-delta", t.producao / t.contratos, c && c.contratos ? c.producao / c.contratos : 0, P.compRotulo);

    const dig = t.producao ? t.digital / t.producao : 0;
    $("k-digital").textContent = pct(dig);
    delta("k-digital-delta", dig, c && c.producao ? c.digital / c.producao : 0, P.compRotulo, "pp");
    sparkline($("k-digital-spark"), porMes(P.meses.map((i) => i)).map((x) => (x.producao ? x.digital / x.producao : 0)));
  }

  function sparkline(svg, vals) {
    svg.replaceChildren();
    const w = svg.clientWidth || 160, h = 34;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    if (vals.length < 2) return;
    const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
    const x = (i) => 4 + (i * (w - 8)) / (vals.length - 1), y = (v) => h - 5 - ((v - min) / rng) * (h - 10);
    el("path", { d: vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(""), fill: "none", estilo: { stroke: "var(--tinta-3)", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" } }, svg);
    el("circle", { cx: x(vals.length - 1), cy: y(vals.at(-1)), r: 4, estilo: { fill: "var(--s1)", stroke: "var(--superficie)", strokeWidth: "2" } }, svg);
  }

  /* ---------- tabela genérica (visão acessível de cada gráfico) ---------- */
  function tabelaSimples(alvo, colunas, linhas) {
    const t = html("table", "tabela");
    const th = html("thead"), tr = html("tr");
    colunas.forEach((c, i) => { const x = html("th", i ? "num" : null, c); x.style.cursor = "default"; tr.appendChild(x); });
    th.appendChild(tr); t.appendChild(th);
    const tb = html("tbody");
    for (const l of linhas) { const r = html("tr"); l.forEach((v, i) => r.appendChild(html("td", i ? "num" : null, v))); tb.appendChild(r); }
    t.appendChild(tb);
    const wrap = html("div", "tabela-rolagem"); wrap.appendChild(t);
    alvo.replaceChildren(wrap);
  }
  const emTabela = (nome) => tabelaAtiva.has(nome);

  function legenda(alvo, itens) {
    alvo.replaceChildren();
    for (const it of itens) {
      const s = html("span"), i = html("i", it.linha ? "linha" : null);
      i.style.background = it.cor; s.append(i, document.createTextNode(it.rotulo)); alvo.appendChild(s);
    }
  }

  /* ---------- 1. Produção mensal × meta ---------- */
  function renderMensal() {
    const alvo = $("g-mensal");
    const meses = P.meses.map((i) => D.meses[i]);
    const dados = porMes(P.meses);
    $("sub-mensal").textContent = `${P.rotulo} · produção aprovada e meta definida pelo planejamento`;
    legenda($("leg-mensal"), [{ rotulo: "Produção", cor: "var(--s1)" }, { rotulo: "Meta", cor: "var(--meta)", linha: true }]);
    if (emTabela("mensal")) {
      tabelaSimples(alvo, ["Mês", "Produção", "Meta", "Atingimento"],
        dados.map((d, i) => [rotuloMes(meses[i], true), brl(d.producao), brl(d.meta), pct(d.meta ? d.producao / d.meta : 0)]));
      return;
    }
    const W = alvo.clientWidth, H = 280, m = { t: 18, r: 12, b: 28, l: 60 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = Math.max(...dados.map((d) => Math.max(d.producao, d.meta))) * 1.08;
    const tk = ticks(max), top = tk.at(-1);
    const y = (v) => m.t + ih - (v / top) * ih;
    const banda = iw / meses.length, bw = Math.min(24, banda * 0.55);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Produção mensal em colunas e meta em linha" });
    for (const v of tk) {
      el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v ? "grade-linha" : "eixo" }, svg);
      el("text", { x: m.l - 10, y: y(v) + 4, "text-anchor": "end", texto: v ? eixoBrl(v) : "0" }, svg);
    }
    const g = el("g", {}, svg);
    dados.forEach((d, i) => {
      const cx = m.l + banda * i + banda / 2;
      el("path", { d: colunaPath(cx - bw / 2, y(d.producao), bw, y(0) - y(d.producao)), class: "marca-hover", "data-i": i, estilo: { fill: "var(--s1)" } }, g);
      const ano = i === 0 || meses[i].endsWith("-01");
      if (i % (banda < 46 ? 2 : 1) === 0) el("text", { x: cx, y: H - 8, "text-anchor": "middle", texto: rotuloMes(meses[i], ano) }, svg);
    });
    const pts = dados.map((d, i) => [m.l + banda * i + banda / 2, y(d.meta)]);
    el("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(""), fill: "none", estilo: { stroke: "var(--meta)", strokeWidth: "2", strokeLinejoin: "round", strokeLinecap: "round" } }, svg);
    pts.forEach((p) => el("circle", { cx: p[0], cy: p[1], r: 4, estilo: { fill: "var(--meta)", stroke: "var(--superficie)", strokeWidth: "2" } }, svg));
    // rótulo seletivo: só o último mês
    const ult = dados.at(-1), xu = pts.at(-1)[0];
    el("text", { x: xu + (xu > W - 60 ? bw / 2 : 0), y: Math.min(y(ult.producao), y(ult.meta)) - 10, "text-anchor": xu > W - 60 ? "end" : "middle", class: "rotulo-forte", texto: brl(ult.producao) }, svg);
    // camada de hover: a banda inteira é o alvo
    const cruz = el("line", { y1: m.t, y2: m.t + ih, class: "eixo", estilo: { opacity: 0 } }, svg);
    dados.forEach((d, i) => {
      const x0 = m.l + banda * i;
      const hit = el("rect", { x: x0, y: m.t, width: banda, height: ih, fill: "transparent", tabindex: 0 }, svg);
      const mostrar = (ev) => {
        cruz.setAttribute("x1", x0 + banda / 2); cruz.setAttribute("x2", x0 + banda / 2); cruz.style.opacity = 1;
        alvo.classList.add("esmaecido");
        g.querySelectorAll(".marca-hover").forEach((n) => n.classList.toggle("ativo", +n.dataset.i === i));
        const r = hit.getBoundingClientRect();
        mostrarDica(ev.clientX ? ev : { clientX: r.left + r.width / 2, clientY: r.top + 40 }, `${rotuloMes(meses[i])}/${meses[i].slice(0, 4)}`, [
          { rotulo: "Produção", valor: brl(d.producao), cor: "var(--s1)" },
          { rotulo: "Meta", valor: brl(d.meta), cor: "var(--meta)" },
          { rotulo: "Atingimento", valor: pct(d.meta ? d.producao / d.meta : 0) },
        ]);
      };
      const sair = () => { cruz.style.opacity = 0; alvo.classList.remove("esmaecido"); esconderDica(); };
      hit.addEventListener("pointermove", mostrar); hit.addEventListener("focus", mostrar);
      hit.addEventListener("pointerleave", sair); hit.addEventListener("blur", sair);
    });
    alvo.replaceChildren(svg);
  }

  /* ---------- 2. Atingimento por regional (ou por agência, ao filtrar uma regional) ---------- */
  const STATUS = [
    { min: 1, cor: "var(--bom)", rotulo: "Acima da meta", icone: "M5 12l4 4 10-10" },
    { min: 0.9, cor: "var(--atencao)", rotulo: "Entre 90% e 100%", icone: "M12 6v8M12 18h.01" },
    { min: -Infinity, cor: "var(--critico)", rotulo: "Abaixo de 90%", icone: "M7 7l10 10M17 7L7 17" },
  ];
  const statusDe = (a) => STATUS.find((s) => a >= s.min);

  function linhasRanking() {
    const set = new Set(P.meses);
    if (estado.regional < 0) {
      const acc = D.regionais.map((nome, r) => ({ nome, r, producao: 0, meta: 0 }));
      for (const [m, r, p, v, , , mt] of D.producao) if (set.has(m) && passaProduto(p)) { acc[r].producao += v; acc[r].meta += mt; }
      return acc;
    }
    const acc = new Map();
    for (const [m, a, p, v, mt] of D.agencia) {
      if (!set.has(m) || !passaProduto(p) || D.agencias[a].regional !== estado.regional) continue;
      const o = acc.get(a) || { nome: D.agencias[a].nome, producao: 0, meta: 0 };
      o.producao += v; o.meta += mt; acc.set(a, o);
    }
    return [...acc.values()];
  }

  function renderRanking() {
    const alvo = $("g-ranking");
    const porAgencia = estado.regional >= 0;
    $("titulo-ranking").textContent = porAgencia ? `Atingimento das agências · ${D.regionais[estado.regional]}` : "Atingimento por regional";
    $("sub-ranking").textContent = porAgencia ? "Produção ÷ meta no período. Use “Limpar filtros” para voltar às regionais." : "Produção ÷ meta no período. Clique numa regional para ver as agências.";
    const linhas = linhasRanking().filter((l) => l.meta > 0).map((l) => ({ ...l, at: l.producao / l.meta })).sort((a, b) => b.at - a.at);
    const leg = $("leg-ranking"); leg.replaceChildren();
    for (const s of STATUS) {
      const sp = html("span");
      const ic = el("svg", { viewBox: "0 0 24 24", width: 14, height: 14, "aria-hidden": "true" });
      el("path", { d: s.icone, fill: "none", "stroke-width": 3, "stroke-linecap": "round", estilo: { stroke: s.cor } }, ic);
      sp.append(ic, document.createTextNode(s.rotulo)); leg.appendChild(sp);
    }
    if (emTabela("ranking")) {
      tabelaSimples(alvo, [porAgencia ? "Agência" : "Regional", "Produção", "Meta", "Atingimento"], linhas.map((l) => [l.nome, brl(l.producao), brl(l.meta), pct(l.at)]));
      return;
    }
    const W = alvo.clientWidth, linhaH = 30, m = { t: 18, r: 64, b: 6, l: Math.min(150, W * 0.42) };
    const H = m.t + linhas.length * linhaH + m.b, iw = W - m.l - m.r;
    const max = Math.max(1.2, ...linhas.map((l) => l.at));
    const x = (v) => m.l + (v / max) * iw;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Atingimento da meta em barras horizontais" });
    el("line", { x1: x(0), x2: x(0), y1: m.t - 4, y2: H - m.b, class: "eixo" }, svg);
    // linha da meta (100%) desenhada antes das barras: os rótulos ficam por cima dela
    el("line", { x1: x(1), x2: x(1), y1: m.t - 6, y2: H - m.b, class: "alvo" }, svg);
    el("text", { x: x(1), y: m.t - 8, "text-anchor": "middle", class: "rotulo-valor", texto: "meta" }, svg);
    linhas.forEach((l, i) => {
      const yc = m.t + i * linhaH + linhaH / 2, bh = 12, s = statusDe(l.at);
      const nome = l.nome.length > 22 ? `${l.nome.slice(0, 21)}…` : l.nome;
      el("text", { x: m.l - 10, y: yc + 4, "text-anchor": "end", estilo: { fill: "var(--tinta-2)" }, texto: nome }, svg);
      el("path", { d: barraPath(x(0), yc - bh / 2, x(l.at) - x(0), bh), estilo: { fill: s.cor } }, svg);
      const ic = el("g", { transform: `translate(${x(l.at) + 6},${yc - 6}) scale(0.5)` }, svg);
      el("path", { d: s.icone, fill: "none", "stroke-width": 4, "stroke-linecap": "round", estilo: { stroke: s.cor } }, ic);
      el("text", { x: x(l.at) + 22, y: yc + 4, class: "rotulo-valor", texto: pct(l.at) }, svg);
      const hit = el("rect", { x: 0, y: yc - linhaH / 2, width: W, height: linhaH, fill: "transparent", tabindex: 0, class: porAgencia ? "" : "clicavel" }, svg);
      const mostrar = (ev) => {
        const r = hit.getBoundingClientRect();
        mostrarDica(ev.clientX ? ev : { clientX: r.left + 40, clientY: r.top }, l.nome, [
          { rotulo: "Atingimento", valor: pct(l.at), cor: s.cor }, { rotulo: "Produção", valor: brl(l.producao) }, { rotulo: "Meta", valor: brl(l.meta) },
        ]);
      };
      hit.addEventListener("pointermove", mostrar); hit.addEventListener("focus", mostrar);
      hit.addEventListener("pointerleave", esconderDica); hit.addEventListener("blur", esconderDica);
      if (!porAgencia) {
        const abrir = () => { esconderDica(); estado.regional = l.r; $("f-regional").value = String(l.r); atualizar(); };
        hit.addEventListener("click", abrir);
        hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } });
      }
    });
    alvo.replaceChildren(svg);
  }

  /* ---------- 3. Produção por produto ---------- */
  function renderProdutos() {
    const alvo = $("g-produtos"), set = new Set(P.meses);
    const acc = D.produtos.map((p, i) => ({ i, nome: p.nome, segmento: p.segmento, producao: 0, meta: 0 }));
    for (const [m, r, p, v, , , mt] of D.producao) {
      if (!set.has(m) || !passaRegional(r) || (estado.segmento !== "Todos" && D.produtos[p].segmento !== estado.segmento)) continue;
      acc[p].producao += v; acc[p].meta += mt;
    }
    const linhas = acc.filter((l) => l.producao > 0).sort((a, b) => b.producao - a.producao);
    const total = linhas.reduce((s, l) => s + l.producao, 0);
    if (emTabela("produtos")) {
      tabelaSimples(alvo, ["Produto", "Produção", "Participação", "Atingimento"], linhas.map((l) => [l.nome, brl(l.producao), pct(l.producao / total), pct(l.meta ? l.producao / l.meta : 0)]));
      return;
    }
    const W = alvo.clientWidth, linhaH = 40, m = { t: 4, r: 8, b: 4, l: 8 };
    const H = m.t + linhas.length * linhaH + m.b, iw = W - m.l - m.r;
    const max = Math.max(...linhas.map((l) => l.producao));
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Produção por produto em barras horizontais" });
    linhas.forEach((l, i) => {
      const y0 = m.t + i * linhaH, destaque = estado.produto < 0 || estado.produto === l.i;
      el("text", { x: m.l, y: y0 + 14, estilo: { fill: "var(--tinta-2)", fontWeight: destaque ? "550" : "400" }, texto: l.nome }, svg);
      el("text", { x: W - m.r, y: y0 + 14, "text-anchor": "end", class: "rotulo-valor", texto: `${brl(l.producao)} · ${pct(l.producao / total, 0)}` }, svg);
      el("rect", { x: m.l, y: y0 + 22, width: iw, height: 8, rx: 4, estilo: { fill: "var(--superficie-2)" } }, svg);
      el("path", { d: barraPath(m.l, y0 + 22, Math.max(2, (l.producao / max) * iw), 8, 4), estilo: { fill: destaque ? "var(--s1)" : "var(--eixo)" } }, svg);
      const hit = el("rect", { x: 0, y: y0, width: W, height: linhaH, fill: "transparent", tabindex: 0 }, svg);
      const mostrar = (ev) => {
        const r = hit.getBoundingClientRect();
        mostrarDica(ev.clientX ? ev : { clientX: r.left + 40, clientY: r.top }, `${l.nome} · ${l.segmento}`, [
          { rotulo: "Produção", valor: brl(l.producao), cor: "var(--s1)" }, { rotulo: "Participação", valor: pct(l.producao / total) },
          { rotulo: "Atingimento", valor: pct(l.meta ? l.producao / l.meta : 0) },
        ]);
      };
      hit.addEventListener("pointermove", mostrar); hit.addEventListener("focus", mostrar);
      hit.addEventListener("pointerleave", esconderDica); hit.addEventListener("blur", esconderDica);
    });
    alvo.replaceChildren(svg);
  }

  /* ---------- 4. Mix de canais (colunas 100% empilhadas) ---------- */
  function renderCanais() {
    const alvo = $("g-canais");
    const meses = P.meses, idx = new Map(meses.map((m, i) => [m, i]));
    const nC = D.canais.length;
    const mat = meses.map(() => new Array(nC).fill(0));
    for (const [m, r, p, c, v] of D.canal) {
      const i = idx.get(m);
      if (i === undefined || !passaProduto(p) || !passaRegional(r)) continue;
      mat[i][c] += v;
    }
    const shares = mat.map((row) => { const s = row.reduce((a, b) => a + b, 0) || 1; return row.map((v) => v / s); });
    legenda($("leg-canais"), D.canais.map((c, i) => ({ rotulo: `${c.nome}${c.tipo === "Digital" ? " (digital)" : ""}`, cor: CORES_CANAL[i] })));
    if (emTabela("canais")) {
      tabelaSimples(alvo, ["Mês", ...D.canais.map((c) => c.nome)], shares.map((row, i) => [rotuloMes(D.meses[meses[i]], true), ...row.map((v) => pct(v))]));
      return;
    }
    const W = alvo.clientWidth, H = 300, m = { t: 10, r: 12, b: 28, l: 44 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const y = (v) => m.t + ih - v * ih;
    const banda = iw / meses.length, bw = Math.min(24, banda * 0.55);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Participação de cada canal na produção mensal" });
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v ? "grade-linha" : "eixo" }, svg);
      el("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end", texto: pct(v, 0) }, svg);
    }
    shares.forEach((row, i) => {
      const cx = m.l + banda * i + banda / 2; let acum = 0;
      row.forEach((v, c) => {
        const y1 = y(acum + v), y0 = y(acum);
        const h = Math.max(0, y0 - y1 - (c < nC - 1 ? 2 : 0)); // 2px de respiro entre segmentos
        const topo = c === nC - 1;
        el("path", { d: topo ? colunaPath(cx - bw / 2, y1, bw, y0 - y1) : `M${cx - bw / 2},${y1 + (y0 - y1 - h)}h${bw}v${h}h${-bw}Z`, estilo: { fill: CORES_CANAL[c] } }, svg);
        acum += v;
      });
      const ano = i === 0 || D.meses[meses[i]].endsWith("-01");
      if (i % (banda < 46 ? 2 : 1) === 0) el("text", { x: cx, y: H - 8, "text-anchor": "middle", texto: rotuloMes(D.meses[meses[i]], ano) }, svg);
    });
    const cruz = el("line", { y1: m.t, y2: m.t + ih, class: "eixo", estilo: { opacity: 0 } }, svg);
    shares.forEach((row, i) => {
      const x0 = m.l + banda * i;
      const hit = el("rect", { x: x0, y: m.t, width: banda, height: ih, fill: "transparent", tabindex: 0 }, svg);
      const mostrar = (ev) => {
        cruz.setAttribute("x1", x0 + banda / 2); cruz.setAttribute("x2", x0 + banda / 2); cruz.style.opacity = 1;
        const dig = D.canais.reduce((s, c, k) => s + (c.tipo === "Digital" ? row[k] : 0), 0);
        const r = hit.getBoundingClientRect();
        mostrarDica(ev.clientX ? ev : { clientX: r.left + r.width / 2, clientY: r.top + 40 }, `${rotuloMes(D.meses[meses[i]])}/${D.meses[meses[i]].slice(0, 4)} · digital ${pct(dig)}`,
          D.canais.map((c, k) => ({ rotulo: c.nome, valor: pct(row[k]), cor: CORES_CANAL[k] })).reverse());
      };
      const sair = () => { cruz.style.opacity = 0; esconderDica(); };
      hit.addEventListener("pointermove", mostrar); hit.addEventListener("focus", mostrar);
      hit.addEventListener("pointerleave", sair); hit.addEventListener("blur", sair);
    });
    alvo.replaceChildren(svg);
  }

  /* ---------- Agências ---------- */
  function renderAgencias() {
    const set = new Set(P.meses), setC = new Set(P.comp);
    const acc = new Map();
    for (const [m, a, p, v, mt] of D.agencia) {
      if (!passaProduto(p) || !passaRegional(D.agencias[a].regional)) continue;
      const atual = set.has(m), comp = setC.has(m);
      if (!atual && !comp) continue;
      const o = acc.get(a) || { nome: D.agencias[a].nome, regional: D.regionais[D.agencias[a].regional], producao: 0, meta: 0, anterior: 0 };
      if (atual) { o.producao += v; o.meta += mt; } else o.anterior += v;
      acc.set(a, o);
    }
    let linhas = [...acc.values()].filter((l) => l.meta > 0 || l.producao > 0)
      .map((l) => ({ ...l, atingimento: l.meta ? l.producao / l.meta : 0, variacao: l.anterior ? l.producao / l.anterior - 1 : null }));
    const { campo, dir } = estado.ordem;
    linhas.sort((a, b) => (typeof a[campo] === "string" ? a[campo].localeCompare(b[campo]) : (a[campo] ?? -9) - (b[campo] ?? -9)) * dir);
    $("sub-agencias").textContent = `${linhas.length} agências · ${P.rotulo}${estado.regional >= 0 ? ` · ${D.regionais[estado.regional]}` : ""}`;
    const total = linhas.length;
    if (!estado.todasAgencias) linhas = linhas.slice(0, 10);
    $("mais-agencias").textContent = estado.todasAgencias ? "Mostrar menos" : `Ver todas (${total})`;
    $("mais-agencias").hidden = total <= 10;
    const tb = $("t-agencias").querySelector("tbody"); tb.replaceChildren();
    for (const l of linhas) {
      const tr = html("tr");
      tr.appendChild(html("td", null, l.nome));
      tr.appendChild(html("td", "sec", l.regional));
      tr.appendChild(html("td", "num", brl(l.producao)));
      tr.appendChild(html("td", "num sec", brl(l.meta)));
      const td = html("td"), box = html("div", "ating"), med = html("div", "medidor"), barra = html("span"), marca = html("i");
      const s = statusDe(l.atingimento);
      barra.style.width = `${Math.min(l.atingimento / 1.3, 1) * 100}%`; barra.style.background = s.cor; marca.style.left = `${(1 / 1.3) * 100}%`;
      med.append(barra, marca);
      const st = html("span", "status");
      const ic = el("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }); el("path", { d: s.icone, fill: "none", "stroke-width": 3, "stroke-linecap": "round", estilo: { stroke: s.cor } }, ic);
      st.append(ic, html("b", null, pct(l.atingimento)));
      st.title = s.rotulo;
      box.append(med, st); td.appendChild(box); tr.appendChild(td);
      tr.appendChild(html("td", `num ${l.variacao == null ? "sec" : l.variacao >= 0 ? "sobe" : "desce"}`, l.variacao == null ? "—" : `${l.variacao >= 0 ? "▲" : "▼"} ${variacao(l.variacao)}`));
      tb.appendChild(tr);
    }
    $("t-agencias").querySelectorAll("th").forEach((th) => {
      th.setAttribute("tabindex", 0);
      if (th.dataset.ordem === campo) th.setAttribute("aria-sort", dir < 0 ? "descending" : "ascending"); else th.removeAttribute("aria-sort");
    });
  }

  /* ---------- Gerentes ---------- */
  function renderGerentes() {
    const set = new Set(P.meses), acc = new Map();
    for (const [m, g, v, c] of D.gerente) {
      if (!set.has(m)) continue;
      const ag = D.agencias[D.gerentes[g].agencia];
      if (!passaRegional(ag.regional)) continue;
      const o = acc.get(g) || { nome: D.gerentes[g].nome, agencia: ag.nome, producao: 0, contratos: 0 };
      o.producao += v; o.contratos += c; acc.set(g, o);
    }
    const top = [...acc.values()].sort((a, b) => b.producao - a.producao).slice(0, 8);
    const ol = $("gerentes"); ol.replaceChildren();
    top.forEach((g, i) => {
      const li = html("li");
      const nome = html("span", "nome", g.nome); nome.appendChild(html("span", "ag", g.agencia));
      const val = html("span", "val", brl(g.producao)); val.appendChild(html("small", null, `${nf(0).format(g.contratos)} contratos`));
      li.append(html("span", "pos", String(i + 1)), nome, val);
      ol.appendChild(li);
    });
  }

  /* ---------- Leituras (storytelling gerado dos dados filtrados) ---------- */
  function frase(partes) {
    const li = html("li"), sp = html("span");
    for (const p of partes) sp.appendChild(typeof p === "string" ? document.createTextNode(p) : html("strong", null, p.f));
    li.appendChild(sp); return li;
  }
  function renderLeituras() {
    const ol = $("leituras"); ol.replaceChildren();
    const t = somar(P.meses), c = P.comp.length ? somar(P.comp) : null;
    const at = t.meta ? t.producao / t.meta : 0, gap = t.producao - t.meta;
    ol.appendChild(frase(["A produção somou ", { f: brl(t.producao) }, ` em ${P.curto}, `, { f: `${pct(at)} da meta` },
      gap >= 0 ? ` (${brl(gap)} acima do planejado).` : ` (faltam ${brl(-gap)}).`]));
    if (c && c.producao) ol.appendChild(frase(["Contra ", P.compRotulo, ", a produção variou ", { f: variacao(t.producao / c.producao - 1) },
      " e o ticket médio foi de ", { f: brlCheio(t.producao / t.contratos) }, "."]));

    const rk = linhasRanking().filter((l) => l.meta > 0).map((l) => ({ ...l, at: l.producao / l.meta })).sort((a, b) => b.at - a.at);
    if (rk.length > 1) {
      const melhor = rk[0], pior = rk.at(-1), nivel = estado.regional >= 0 ? "agência" : "regional";
      ol.appendChild(frase([`Maior atingimento: ${nivel} `, { f: `${melhor.nome} (${pct(melhor.at)})` }, ". Menor: ", { f: `${pior.nome} (${pct(pior.at)})` },
        `, ${nf(1).format((melhor.at - pior.at) * 100)} p.p. de diferença.`]));
      const abaixo = rk.filter((l) => l.at < 0.9);
      if (abaixo.length) ol.appendChild(frase([`${abaixo.length === 1 ? "Uma" : abaixo.length} ${nivel === "regional" ? (abaixo.length === 1 ? "regional está" : "regionais estão") : (abaixo.length === 1 ? "agência está" : "agências estão")} abaixo de 90% da meta: `,
        { f: abaixo.slice(0, 3).map((l) => l.nome).join(", ") + (abaixo.length > 3 ? "…" : "") }, ". Pede plano de ação com a liderança comercial."]));
    }
    const dm = porMes(P.meses).map((x) => (x.producao ? x.digital / x.producao : 0));
    if (dm.length > 1) ol.appendChild(frase(["A participação dos canais digitais foi de ", { f: pct(dm[0]) }, " para ", { f: pct(dm.at(-1)) },
      ` no período (${pp(dm.at(-1) - dm[0])}).`]));

    // público 50+ no consignado
    const set = new Set(P.meses), cons = D.produtos.map((p, i) => (p.familia === "Consignado" ? i : -1)).filter((i) => i >= 0);
    const f50 = D.faixas.map((f, i) => (f === "50-64" || f === "65+" ? i : -1)).filter((i) => i >= 0);
    let tot = 0, mais50 = 0;
    for (const [m, r, p, f, v] of D.faixa) if (set.has(m) && cons.includes(p) && passaRegional(r) && passaProduto(p)) { tot += v; if (f50.includes(f)) mais50 += v; }
    if (tot) ol.appendChild(frase(["No consignado, ", { f: `${pct(mais50 / tot, 0)} da produção` }, " vem de clientes com 50 anos ou mais, o público central do banco."]));
  }

  /* ---------- orquestração ---------- */
  function atualizar() {
    P = periodos()[estado.periodo];
    document.querySelector(".pagina").classList.add("carregando");
    requestAnimationFrame(() => {
      renderKpis(); renderMensal(); renderRanking(); renderProdutos(); renderCanais(); renderAgencias(); renderGerentes(); renderLeituras();
      document.querySelector(".pagina").classList.remove("carregando");
    });
  }

  function montarFiltros() {
    const ps = periodos(), seg = $("f-periodo");
    for (const [chave, p] of Object.entries(ps)) {
      const b = html("button", null, chave === "ytd" ? `Acumulado ${p.rotulo.slice(0, 4)}` : p.rotulo);
      b.type = "button"; b.setAttribute("aria-pressed", String(chave === estado.periodo));
      b.addEventListener("click", () => { estado.periodo = chave; seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); atualizar(); });
      seg.appendChild(b);
    }
    const reg = $("f-regional"); reg.appendChild(new Option("Todas as regionais", "-1"));
    D.regionais.forEach((r, i) => reg.appendChild(new Option(r, String(i))));
    const pro = $("f-produto"); pro.appendChild(new Option("Todos os produtos", "-1"));
    D.produtos.forEach((p, i) => pro.appendChild(new Option(`${p.nome} (${p.segmento})`, String(i))));
    $("f-segmento").addEventListener("change", (e) => { estado.segmento = e.target.value; if (estado.produto >= 0 && estado.segmento !== "Todos" && D.produtos[estado.produto].segmento !== estado.segmento) { estado.produto = -1; pro.value = "-1"; } atualizar(); });
    reg.addEventListener("change", (e) => { estado.regional = +e.target.value; atualizar(); });
    pro.addEventListener("change", (e) => { estado.produto = +e.target.value; if (estado.produto >= 0) { estado.segmento = "Todos"; $("f-segmento").value = "Todos"; } atualizar(); });
    $("limpar").addEventListener("click", () => {
      Object.assign(estado, { segmento: "Todos", regional: -1, produto: -1 });
      $("f-segmento").value = "Todos"; reg.value = "-1"; pro.value = "-1"; atualizar();
    });
    $("mais-agencias").addEventListener("click", () => { estado.todasAgencias = !estado.todasAgencias; renderAgencias(); });
    $("t-agencias").querySelectorAll("th").forEach((th) => {
      const ordenar = () => {
        const c = th.dataset.ordem;
        estado.ordem = { campo: c, dir: estado.ordem.campo === c ? -estado.ordem.dir : (c === "nome" || c === "regional" ? 1 : -1) };
        renderAgencias();
      };
      th.addEventListener("click", ordenar);
      th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ordenar(); } });
    });
    document.querySelectorAll(".alternar-tabela").forEach((b) => {
      const nome = b.closest(".cartao").dataset.grafico;
      b.addEventListener("click", () => {
        if (tabelaAtiva.has(nome)) tabelaAtiva.delete(nome); else tabelaAtiva.add(nome);
        b.textContent = tabelaAtiva.has(nome) ? "Ver gráfico" : "Ver tabela";
        atualizar();
      });
    });
  }

  function tema() {
    const raiz = document.documentElement;
    try { const t = localStorage.getItem("painel-tema"); if (t) raiz.dataset.theme = t; } catch (_) { /* sem armazenamento */ }
    const q = new URLSearchParams(location.search).get("tema");
    if (q) raiz.dataset.theme = q === "escuro" ? "dark" : "light";
    $("tema").addEventListener("click", () => {
      const escuro = raiz.dataset.theme ? raiz.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      raiz.dataset.theme = escuro ? "light" : "dark";
      try { localStorage.setItem("painel-tema", raiz.dataset.theme); } catch (_) { /* sem armazenamento */ }
    });
  }

  async function iniciar() {
    tema();
    D = await (await fetch("dados.json")).json();
    const ult = D.meses.at(-1);
    $("atualizacao").textContent = `Dados até ${rotuloMes(ult)}/${ult.slice(0, 4)}`;
    montarFiltros();
    atualizar();
    let t;
    new ResizeObserver(() => { clearTimeout(t); t = setTimeout(atualizar, 120); }).observe(document.querySelector(".grade"));
  }
  iniciar().catch((e) => { document.querySelector(".pagina").prepend(html("p", null, `Não foi possível carregar os dados: ${e.message}`)); });
})();
