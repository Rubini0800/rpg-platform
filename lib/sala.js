"use strict";
// Modelo de uma sala/campanha: criação, normalização do que vem do banco e serialização para salvar.
// O formato do estado é o MESMO que o projeto já usava em campanhas-salvas.json.

const novaNevoa = () => ({ ativada: false, raioFt: 60, modoExploracao: "persistente", revelacoes: [], marcasManuais: [], paredes: [] });

function novaSala() {
    return {
        mestreId: null, participantes: new Map(), objetos: [], areasEfeito: [], bibliotecaTokens: [], desenhos: [],
        nevoa: novaNevoa(), pesPorQuadrado: 5, gradePx: 32, gradeX: 5000, gradeY: 4000,
        view: { zoom: 1, posX: 0, posY: 0 }, mapaBloqueado: false,
    };
}

function normalizarNevoa(n) {
    if (!n || typeof n !== "object") return novaNevoa();
    const arr = v => (Array.isArray(v) ? v : []);
    return {
        ativada: Boolean(n.ativada),
        raioFt: [30, 60, 90, 120].includes(Number(n.raioFt)) ? Number(n.raioFt) : 60,
        modoExploracao: n.modoExploracao === "dinamica" ? "dinamica" : "persistente",
        revelacoes: arr(n.revelacoes).filter(r => r && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.raioFt)).slice(-2000),
        marcasManuais: arr(n.marcasManuais).filter(r => r && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.raio))
            .map(r => ({ x: r.x, y: r.y, raio: r.raio, tipo: r.tipo === "revelar" ? "revelar" : "cobrir", forma: r.forma === "quadrado" ? "quadrado" : "circulo" })).slice(-5000),
        paredes: arr(n.paredes).filter(w => w && [w.x1, w.y1, w.x2, w.y2].every(Number.isFinite))
            .map(w => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, aberta: Boolean(w.aberta) })).slice(-1000),
    };
}

// Reconstrói uma sala em memória a partir do estado guardado (banco/arquivo).
function normalizarEstado(salvo) {
    const s = salvo && typeof salvo === "object" ? salvo : {};
    const sala = novaSala();
    sala.objetos = Array.isArray(s.objetos) ? s.objetos : [];
    sala.areasEfeito = Array.isArray(s.areasEfeito) ? s.areasEfeito : [];
    sala.bibliotecaTokens = Array.isArray(s.bibliotecaTokens) ? s.bibliotecaTokens : [];
    sala.desenhos = Array.isArray(s.desenhos) ? s.desenhos : [];
    sala.nevoa = normalizarNevoa(s.nevoa);
    sala.pesPorQuadrado = Number(s.pesPorQuadrado) || 5;
    sala.gradePx = Number(s.gradePx) || 32;
    sala.gradeX = Number.isFinite(s.gradeX) ? s.gradeX : 5000;
    sala.gradeY = Number.isFinite(s.gradeY) ? s.gradeY : 4000;
    sala.view = s.view && typeof s.view === "object" ? s.view : { zoom: 1, posX: 0, posY: 0 };
    sala.mapaBloqueado = Boolean(s.mapaBloqueado);
    return sala;
}

// O que vai para o banco: só o estado da mesa. Participantes, sockets e a chave do Mestre ficam de fora.
function serializar(sala) {
    return {
        objetos: sala.objetos || [], areasEfeito: sala.areasEfeito || [], bibliotecaTokens: sala.bibliotecaTokens || [],
        desenhos: sala.desenhos || [], nevoa: sala.nevoa || novaNevoa(),
        pesPorQuadrado: sala.pesPorQuadrado || 5, gradePx: sala.gradePx || 32,
        gradeX: Number.isFinite(sala.gradeX) ? sala.gradeX : 5000, gradeY: Number.isFinite(sala.gradeY) ? sala.gradeY : 4000,
        view: sala.view || { zoom: 1, posX: 0, posY: 0 }, mapaBloqueado: Boolean(sala.mapaBloqueado),
    };
}

// Chaves (ids no serviço de imagens) ainda em uso por objetos do mapa ou pela biblioteca de tokens.
function chavesEmUso(sala) {
    const usadas = new Set();
    for (const item of [...sala.objetos, ...sala.bibliotecaTokens]) if (item && item.chave) usadas.add(item.chave);
    return usadas;
}

module.exports = { novaSala, normalizarEstado, serializar, chavesEmUso };
