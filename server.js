"use strict";
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
const { criarStore } = require("./lib/store");
const { criarStorage } = require("./lib/storage");
const { novaSala, normalizarEstado, serializar, chavesEmUso } = require("./lib/sala");
const { detectarTipo } = require("./lib/imagem");
const { criarLimitador } = require("./lib/limitador");

// ---------- Configuração ----------
const PORTA = Number(process.env.PORT) || 3000;            // o Render define PORT; localmente usa 3000
const SALVAR_APOS_MS = 1500;                               // agrupa várias alterações em uma gravação
const EVICAR_APOS_MS = 5 * 60 * 1000;                      // sala vazia sai da memória (continua no banco)
const MAX_MAPA_BYTES = 4 * 1024 * 1024;
const MAX_TOKEN_BYTES = 300 * 1024;
const MAX_OBJETOS_POR_SALA = 40;
const MAX_TOKENS_BIBLIOTECA = 60;
// Quantos proxies confiáveis ficam na frente do app (Render = 1). Usado só para identificar o IP no limitador.
const PROXIES_CONFIAVEIS = Number(process.env.TRUST_PROXY_HOPS ?? 1);

const app = express();
const servidor = http.createServer(app);
// Imagens agora vão por HTTP (POST /api/imagens), então o canal de WebSocket pode ser pequeno.
const io = new Server(servidor, { maxHttpBufferSize: 1024 * 1024 });
app.disable("x-powered-by");
let store, storage;                                        // definidos em iniciar()

// Salas ATIVAS (com gente conectada ou recém-usadas). A fonte da verdade é o banco: a sala é
// carregada de lá quando alguém entra e volta para lá quando é salva.
const salas = new Map();

const limiteCriarSala = criarLimitador({ max: 30, janelaMs: 60 * 60 * 1000 });
const limiteFalhasEntrada = criarLimitador({ max: 30, janelaMs: 10 * 60 * 1000 });
const limiteFalhasGlobal = criarLimitador({ max: 600, janelaMs: 10 * 60 * 1000 });
const limiteUpload = criarLimitador({ max: 20, janelaMs: 60 * 1000 });

// ---------- Segurança HTTP ----------
function politicaCsp() {
    const imagens = ["'self'", "data:", "blob:"];
    if (storage?.origemImagens) imagens.push(storage.origemImagens);
    return `default-src 'self'; img-src ${imagens.join(" ")}; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`;
}
app.use((req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": politicaCsp() });
    next();
});

// SOMENTE estes arquivos são públicos. (Antes, express.static(__dirname) expunha server.js,
// package.json e o campanhas-salvas.json inteiro, com todos os códigos de sala.)
const ARQUIVOS_PUBLICOS = { "/": "index.html", "/index.html": "index.html", "/script.js": "script.js", "/style.css": "style.css" };
for (const [rota, arquivo] of Object.entries(ARQUIVOS_PUBLICOS)) app.get(rota, (req, res) => res.sendFile(path.join(__dirname, arquivo)));
app.get("/saude", (req, res) => res.json({ ok: true, campanhas: store?.nome, imagens: storage?.nome, salasAtivas: salas.size }));
// Só no modo de desenvolvimento (imagens em disco local) o próprio servidor entrega as imagens.
let estaticoUploads;
app.use("/uploads", (req, res, next) => {
    if (storage?.nome !== "local") return res.status(404).end();
    estaticoUploads ||= express.static(storage.diretorio, { index: false, dotfiles: "deny", maxAge: "1h" });
    estaticoUploads(req, res, next);
});

function ipDe(req) {
    const xff = String(req.headers?.["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean);
    if (PROXIES_CONFIAVEIS > 0 && xff.length >= PROXIES_CONFIAVEIS) return xff[xff.length - PROXIES_CONFIAVEIS];
    return req.socket?.remoteAddress || "desconhecido";
}

// ---------- Utilidades ----------
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODIGO_VALIDO = new RegExp(`^[${ALFABETO}]{6}$`);
const gerarCodigo = () => Array.from({ length: 6 }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join("");
const novoId = prefixo => `${prefixo}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
const limparTexto = (valor, max) => String(valor ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
const hashChave = chave => crypto.createHash("sha256").update(chave).digest("hex");
function chaveConfere(chave, hashGuardado) {
    const a = Buffer.from(hashChave(chave)), b = Buffer.from(String(hashGuardado || ""));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Persistência ----------
// Cada alteração só marca a sala como "suja"; a gravação acontece até SALVAR_APOS_MS depois,
// no máximo uma por vez por sala. Evita gravar a cada movimento e nunca bloqueia o event loop.
function agendarSalvamento(codigo) {
    const sala = salas.get(codigo); if (!sala) return;
    sala.sujo = true;
    if (!sala.timerSalvar) sala.timerSalvar = setTimeout(() => { sala.timerSalvar = null; salvarSala(codigo).catch(() => {}); }, SALVAR_APOS_MS);
}
function salvarSala(codigo, { forcar = false } = {}) {
    const sala = salas.get(codigo); if (!sala) return Promise.resolve(true);
    if (sala.timerSalvar) { clearTimeout(sala.timerSalvar); sala.timerSalvar = null; }
    sala.fila = (sala.fila || Promise.resolve()).then(async () => {
        if (!sala.sujo && !forcar) return true;
        sala.sujo = false;
        try {
            await store.salvar(codigo, serializar(sala));
            await limparImagensOrfas(sala);
            return true;
        } catch (erro) {
            console.error(`[salvar] falha na sala ${codigo}:`, erro.message);
            sala.sujo = true;
            if (!sala.timerSalvar) sala.timerSalvar = setTimeout(() => { sala.timerSalvar = null; salvarSala(codigo).catch(() => {}); }, 5000);
            return false;
        }
    });
    return sala.fila;
}

// Imagens que saíram do mapa/biblioteca são apagadas do armazenamento só DEPOIS de o estado novo
// ter sido salvo, para o banco nunca apontar para uma imagem já removida.
function marcarImagemOrfa(sala, chave) { if (chave) (sala.chavesOrfas ||= new Set()).add(chave); }
async function limparImagensOrfas(sala) {
    if (!sala.chavesOrfas?.size) return;
    const emUso = chavesEmUso(sala), candidatas = [...sala.chavesOrfas]; sala.chavesOrfas.clear();
    for (const chave of candidatas) {
        if (emUso.has(chave)) continue;
        try { await storage.remover(chave); } catch (erro) { console.error("[imagens] não consegui remover", chave, "-", erro.message); }
    }
}

const carregando = new Map();
function obterSala(codigo) {
    const viva = salas.get(codigo); if (viva) return Promise.resolve(viva);
    if (!carregando.has(codigo)) {
        carregando.set(codigo, (async () => {
            const registro = await store.carregar(codigo); if (!registro) return null;
            const sala = normalizarEstado(registro.estado);
            sala.mestreHash = registro.mestreHash; salas.set(codigo, sala); return sala;
        })().finally(() => carregando.delete(codigo)));
    }
    return carregando.get(codigo);
}

function agendarEvicao(codigo) {
    const sala = salas.get(codigo); if (!sala) return;
    clearTimeout(sala.timerEvicao);
    sala.timerEvicao = setTimeout(async () => {
        if (salas.get(codigo) !== sala || sala.participantes.size) return;
        await salvarSala(codigo);
        if (!sala.sujo && !sala.participantes.size && salas.get(codigo) === sala) salas.delete(codigo);
    }, EVICAR_APOS_MS);
    sala.timerEvicao.unref?.();
}

function listarParticipantes(sala) { return Array.from(sala.participantes.values()).map(p => ({ nome: p.nome, papel: p.papel })); }
function atualizarParticipantes(codigo) { const sala = salas.get(codigo); if (sala) io.to(codigo).emit("atualizar-sala", { codigo, participantes: listarParticipantes(sala) }); }
function objetosVisiveisPara(socket, sala) {
    return sala.objetos.filter(obj => socket.data.papel === "Mestre" || !obj.oculto);
}
function bibliotecaVisivelPara(socket, sala) { return sala.bibliotecaTokens.filter(token => socket.data.papel === "Mestre" || !token.oculto); }
function emitirBiblioteca(codigo, sala) { for (const socketId of sala.participantes.keys()) { const participante=io.sockets.sockets.get(socketId); if(participante) io.to(socketId).emit("biblioteca-tokens-atualizada", bibliotecaVisivelPara(participante,sala)); } }
function emitirObjetos(codigo, sala) {
    for (const socketId of sala.participantes.keys()) {
        const participante = io.sockets.sockets.get(socketId);
        if (participante) io.to(socketId).emit("objetos-atualizados", objetosVisiveisPara(participante, sala));
    }
}
function ehParticipante(socket, sala) { return Boolean(sala && socket.data.codigoSala && sala.participantes.has(socket.id)); }
function parsearExpressao(expressao, bonus) {
    if (typeof expressao !== "string" || expressao.length > 80) throw new Error("Use uma expressão curta, como 1d20 + 5 ou 2d6 + 1d8.");
    const normalizada = expressao.toLowerCase().replace(/\s+/g, "").replace(/-/g, "+-");
    const termos = normalizada.split("+").filter(Boolean);
    if (!termos.length || termos.length > 12) throw new Error("A expressão deve ter entre 1 e 12 termos.");
    const resultados = []; let soma = 0; let totalDados = 0;
    for (const termo of termos) {
        const dado = termo.match(/^([+-]?\d*)d(4|6|8|10|12|16|20|100)$/);
        if (dado) {
            let quantidadeTexto = dado[1]; let sinal = 1;
            if (quantidadeTexto.startsWith("-")) { sinal = -1; quantidadeTexto = quantidadeTexto.slice(1); }
            else if (quantidadeTexto.startsWith("+")) quantidadeTexto = quantidadeTexto.slice(1);
            const quantidade = (quantidadeTexto === "" ? 1 : Number(quantidadeTexto)) * sinal;
            if (!Number.isInteger(quantidade) || Math.abs(quantidade) < 1 || Math.abs(quantidade) > 100) throw new Error("Cada termo pode rolar de 1 a 100 dados.");
            const lados = Number(dado[2]); totalDados += Math.abs(quantidade);
            if (totalDados > 200) throw new Error("O limite por rolagem é de 200 dados.");
            const valores = Array.from({ length: Math.abs(quantidade) }, () => Math.floor(Math.random() * lados) + 1);
            const total = valores.reduce((a, b) => a + b, 0) * Math.sign(quantidade);
            resultados.push({ quantidade, lados, valores, total }); soma += total;
        } else if (/^[+-]?\d{1,6}$/.test(termo)) {
            soma += Number(termo);
        } else throw new Error(`Termo inválido: "${termo}". Use dados como d20, 2d6 ou números.`);
    }
    const bonusSeguro = Number(bonus || 0);
    if (!Number.isFinite(bonusSeguro) || !Number.isInteger(bonusSeguro) || Math.abs(bonusSeguro) > 100000) throw new Error("O bônus precisa ser um número inteiro entre -100000 e 100000.");
    return { resultados, soma, bonus: bonusSeguro, total: soma + bonusSeguro };
}


// ---------- Estado inicial enviado a quem entra ----------
function enviarEstadoCenario(socket, sala) {
    socket.emit("estado-cenario", { objetos: objetosVisiveisPara(socket, sala), areasEfeito: sala.areasEfeito || [], bibliotecaTokens: bibliotecaVisivelPara(socket, sala), desenhos: sala.desenhos, nevoa: sala.nevoa, mapaBloqueado: Boolean(sala.mapaBloqueado), pesPorQuadrado: sala.pesPorQuadrado, gradePx: sala.gradePx, gradeX: sala.gradeX, gradeY: sala.gradeY, view: sala.view });
}

// ---------- Imagens (mapas e tokens) ----------
// Os arquivos ficam no serviço externo (Cloudinary); a sala guarda só a URL e a chave para apagar depois.
function adicionarImagem(codigo, sala, { tipo, nome, url, chave, grade }) {
    const limite = (min, max, v) => Math.max(min, Math.min(max, v));
    if (tipo === "mapa") {
        const largura = 900;
        const left = 4760 + (sala.objetos.length % 5) * 90, top = 3600 + (sala.objetos.length % 5) * 65;
        sala.objetos.push({ id: novoId("imagem"), tipo: "mapa", nome: nome || "Mapa", url, chave, largura, left, top });
        if (grade && Number.isFinite(Number(grade.gradePx))) {
            sala.gradePx = limite(8, 180, Number(grade.gradePx));
            sala.gradeX = left + limite(0, largura, Number(grade.faseX) || 0);
            sala.gradeY = top + limite(0, largura, Number(grade.faseY) || 0);
        }
        agendarSalvamento(codigo);
        io.to(codigo).emit("grade-visual-atualizada", { gradePx: sala.gradePx, gradeX: sala.gradeX, gradeY: sala.gradeY });
        emitirObjetos(codigo, sala);
        return grade ? "Mapa adicionado. Tentei detectar a grade automaticamente; confira o alinhamento e use +Grade/-Grade para corrigir." : "Imagem adicionada e compartilhada com a sala!";
    }
    const bibliotecaId = novoId("personagem"), nomeToken = nome || "Personagem";
    sala.bibliotecaTokens.push({ id: bibliotecaId, nome: nomeToken, url, chave, tamanhoFt: 5 });
    sala.objetos.push({ id: novoId("token"), bibliotecaId, tipo: "token", nome: nomeToken, url, chave, tamanhoFt: 5, left: 4960 + (sala.objetos.length % 6) * 18, top: 3980 + (sala.objetos.length % 6) * 18 });
    agendarSalvamento(codigo); emitirObjetos(codigo, sala); emitirBiblioteca(codigo, sala);
    return "Token adicionado e salvo na bandeja de personagens!";
}

// Upload por HTTP (corpo = bytes da imagem). Quem envia precisa provar que está numa sala: o cabeçalho
// X-Socket-Id é o id da conexão WebSocket dele, que o servidor só entregou a ele mesmo.
app.post("/api/imagens", express.raw({ type: () => true, limit: MAX_MAPA_BYTES + 1024 }), async (req, res) => {
    const responder = (status, mensagem) => res.status(status).json({ ok: status < 400, mensagem });
    try {
        const socket = io.sockets.sockets.get(String(req.get("x-socket-id") || ""));
        const codigo = socket?.data.codigoSala, sala = codigo ? salas.get(codigo) : null;
        if (!socket || !ehParticipante(socket, sala)) return responder(403, "Entre em uma sala primeiro.");
        if (!limiteUpload.permitir(socket.id)) return responder(429, "Muitos envios seguidos. Aguarde um instante.");
        const tipo = req.query.tipo === "mapa" ? "mapa" : "token";
        const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const maximo = tipo === "mapa" ? MAX_MAPA_BYTES : MAX_TOKEN_BYTES;
        if (!buffer.length || buffer.length > maximo) return responder(400, tipo === "mapa" ? "Imagem inválida ou muito grande. Use PNG/JPG/WEBP/GIF de até 4 MB." : "Token inválido ou muito grande. Use PNG/JPG/WEBP/GIF de até 300 KB.");
        const mime = detectarTipo(buffer);
        if (!mime) return responder(400, "O arquivo não é uma imagem PNG, JPG, WEBP ou GIF válida.");
        if (sala.objetos.length >= MAX_OBJETOS_POR_SALA) return responder(400, "Limite de 40 itens por sala.");
        if (tipo === "token" && sala.bibliotecaTokens.length >= MAX_TOKENS_BIBLIOTECA) return responder(400, "A biblioteca de personagens está cheia. Apague algum token salvo.");
        let grade = null;
        if (tipo === "mapa" && req.query.grade) { try { grade = JSON.parse(String(req.query.grade).slice(0, 500)); } catch { grade = null; } }
        const nome = limparTexto(req.query.nome, 40);

        const { url, chave } = await storage.salvar({ buffer, mime, pasta: codigo });

        // Durante o upload a pessoa pode ter saído ou a sala encher: confere de novo antes de aplicar.
        if (salas.get(codigo) !== sala || !ehParticipante(socket, sala) || sala.objetos.length >= MAX_OBJETOS_POR_SALA) {
            storage.remover(chave).catch(() => {});
            return responder(409, "A sala mudou durante o envio. Tente de novo.");
        }
        const mensagemOk = adicionarImagem(codigo, sala, { tipo, nome: nome || (tipo === "token" ? "Personagem" : "Mapa"), url, chave, grade });
        await salvarSala(codigo);          // upload é raro e caro de refazer: grava já, sem esperar o agrupamento de 1,5 s
        responder(200, mensagemOk);
    } catch (erro) {
        console.error("[upload]", erro.message);
        responder(502, "Não foi possível guardar a imagem agora. Tente novamente em instantes.");
    }
});
app.use((erro, req, res, next) => {
    if (erro?.type === "entity.too.large") return res.status(413).json({ ok: false, mensagem: "Imagem muito grande." });
    console.error("[http]", erro?.message || erro);
    res.status(500).json({ ok: false, mensagem: "Erro interno." });
});

io.on("connection", socket => {
    console.log("Conexão recebida:", socket.id);

    socket.on("criar-sala", async (dados, responder) => {
        if (socket.data.codigoSala || socket.data.ocupado) return responder?.({ ok: false, mensagem: "Você já está em uma sala." });
        const nome = limparTexto(dados?.nome, 24);
        if (!nome) return responder?.({ ok: false, mensagem: "Digite seu nome." });
        if (!limiteCriarSala.permitir(ipDe(socket.request))) return responder?.({ ok: false, mensagem: "Muitas salas criadas por aqui. Tente novamente mais tarde." });
        socket.data.ocupado = true;
        try {
            // A Chave do Mestre só existe aqui: o servidor guarda apenas o hash dela.
            const chaveMestre = crypto.randomBytes(24).toString("base64url");
            const sala = novaSala(); sala.mestreHash = hashChave(chaveMestre);
            let codigo = null;
            for (let i = 0; i < 10 && !codigo; i++) {
                const candidato = gerarCodigo();
                if (await store.criar(candidato, serializar(sala), sala.mestreHash)) codigo = candidato;   // o banco garante que o código é único
            }
            if (!codigo) throw new Error("não achei um código livre");
            if (!socket.connected) return;                          // saiu durante a criação: a sala fica salva, sem ninguém dentro
            sala.mestreId = socket.id; sala.participantes.set(socket.id, { nome, papel: "Mestre" }); salas.set(codigo, sala);
            socket.join(codigo); socket.data.codigoSala = codigo; socket.data.papel = "Mestre";
            responder?.({ ok: true, codigo, papel: "Mestre", chaveMestre, mensagem: "Sala criada e salva. Guarde a Chave do Mestre: ela é a única forma de voltar como Mestre." });
            enviarEstadoCenario(socket, sala); atualizarParticipantes(codigo);
            console.log("Sala criada:", codigo);
        } catch (erro) {
            console.error("[criar-sala]", erro.message);
            responder?.({ ok: false, mensagem: "Não foi possível criar a sala agora. Tente novamente." });
        } finally { socket.data.ocupado = false; }
    });

    socket.on("entrar-sala", async (dados, responder) => {
        if (socket.data.codigoSala || socket.data.ocupado) return responder?.({ ok: false, mensagem: "Você já está em uma sala." });
        const nome = limparTexto(dados?.nome, 24), codigo = String(dados?.codigo || "").trim().toUpperCase();
        const chaveMestre = typeof dados?.chaveMestre === "string" ? dados.chaveMestre.trim().slice(0, 100) : "";
        if (!nome || !codigo) return responder?.({ ok: false, mensagem: "Digite seu nome e o código da sala." });
        const ip = ipDe(socket.request);
        if (limiteFalhasEntrada.bloqueado(ip) || limiteFalhasGlobal.bloqueado("global")) return responder?.({ ok: false, mensagem: "Muitas tentativas. Aguarde alguns minutos." });
        const falhar = mensagem => { limiteFalhasEntrada.registrar(ip); limiteFalhasGlobal.registrar("global"); responder?.({ ok: false, mensagem }); };
        socket.data.ocupado = true;
        try {
            const sala = CODIGO_VALIDO.test(codigo) ? await obterSala(codigo) : null;
            if (!socket.connected) return;
            if (!sala) return falhar("Sala não encontrada. Confira o código.");
            // O papel NÃO depende mais de "ser o primeiro a entrar": só vira Mestre quem apresenta a chave.
            if (chaveMestre && !chaveConfere(chaveMestre, sala.mestreHash)) return falhar("Chave do Mestre inválida.");
            const ehMestre = Boolean(chaveMestre);
            const papel = ehMestre ? "Mestre" : "Jogador";

            for (const id of [...sala.participantes.keys()]) if (!io.sockets.sockets.has(id)) sala.participantes.delete(id);   // conexões fantasmas
            if (ehMestre && sala.mestreId && sala.mestreId !== socket.id) {            // Mestre abriu em outra aba/dispositivo: a sessão antiga sai
                const antigo = io.sockets.sockets.get(sala.mestreId);
                sala.participantes.delete(sala.mestreId);
                if (antigo) { antigo.leave(codigo); delete antigo.data.codigoSala; delete antigo.data.papel; antigo.emit("sessao-substituida"); }
            }
            if (ehMestre) sala.mestreId = socket.id;
            clearTimeout(sala.timerEvicao);
            sala.participantes.set(socket.id, { nome, papel }); socket.join(codigo);
            socket.data.codigoSala = codigo; socket.data.papel = papel;
            responder?.({ ok: true, codigo, papel, mensagem: ehMestre ? "Campanha carregada. Você retomou como Mestre." : "Conectado à campanha salva." });
            enviarEstadoCenario(socket, sala); atualizarParticipantes(codigo);
            if (ehMestre) io.to(codigo).emit("mestre-presente");
            console.log(nome + " entrou na sala " + codigo + " como " + papel);
        } catch (erro) {
            console.error("[entrar-sala]", erro.message);
            responder?.({ ok: false, temporario: true, mensagem: "Não foi possível entrar agora. Tente novamente." });
        } finally { socket.data.ocupado = false; }
    });

    // Versões antigas da página enviavam a imagem inteira pelo WebSocket. Agora é por HTTP.
    for (const evento of ["adicionar-imagem", "adicionar-token"]) {
        socket.on(evento, (dados, responder) => responder?.({ ok: false, mensagem: "Sua página está desatualizada. Recarregue com Ctrl+F5 para enviar imagens." }));
    }

    socket.on("adicionar-desenho", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        if (!Array.isArray(dados?.pontos) || dados.pontos.length < 2 || dados.pontos.length > 2500) return responder?.({ ok: false, mensagem: "Desenho inválido." });
        const pontos = dados.pontos.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 15000 && Math.abs(p.y) <= 12000).map(p => ({ x: p.x, y: p.y }));
        if (pontos.length < 2) return responder?.({ ok: false, mensagem: "Desenho sem pontos suficientes." });
        sala.desenhos.push({ id: "desenho-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6), pontos, cor: "#ffdf70", largura: 3 });
        if (sala.desenhos.length > 200) sala.desenhos.shift();
        agendarSalvamento(codigo); io.to(codigo).emit("desenhos-atualizados", sala.desenhos); responder?.({ ok: true });
    });
    socket.on("limpar-desenhos", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        sala.desenhos = []; agendarSalvamento(codigo); io.to(codigo).emit("desenhos-atualizados", sala.desenhos); responder?.({ ok: true });
    });
    socket.on("apagar-desenho", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        const indice = sala.desenhos.findIndex(d => d.id === dados?.id);
        if (indice < 0) return responder?.({ ok: false, mensagem: "Traço não encontrado." });
        sala.desenhos.splice(indice, 1); agendarSalvamento(codigo); io.to(codigo).emit("desenhos-atualizados", sala.desenhos); responder?.({ ok: true });
    });
    socket.on("configurar-nevoa", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || socket.data.papel !== "Mestre") return responder?.({ ok: false, mensagem: "Somente o mestre pode configurar a escuridão." });
        const ativada = Boolean(dados?.ativada), raioFt = Number(dados?.raioFt);
        if (![30, 60, 90, 120].includes(raioFt)) return responder?.({ ok: false, mensagem: "Escolha um alcance válido." });
        sala.nevoa = sala.nevoa || { ativada: false, raioFt: 60, revelacoes: [] };
        sala.nevoa.ativada = ativada; sala.nevoa.raioFt = raioFt; sala.nevoa.modoExploracao = dados?.modoExploracao === "dinamica" ? "dinamica" : "persistente"; if (sala.nevoa.modoExploracao === "dinamica") sala.nevoa.revelacoes = []; sala.nevoa.marcasManuais = Array.isArray(sala.nevoa.marcasManuais) ? sala.nevoa.marcasManuais : []; sala.nevoa.paredes = Array.isArray(sala.nevoa.paredes) ? sala.nevoa.paredes : [];
        agendarSalvamento(codigo); io.to(codigo).emit("nevoa-atualizada", sala.nevoa); responder?.({ ok: true });
    });
    socket.on("limpar-revelacao-nevoa", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || socket.data.papel !== "Mestre") return responder?.({ ok: false, mensagem: "Somente o mestre pode reiniciar a escuridão." });
        sala.nevoa = sala.nevoa || { ativada: false, raioFt: 60, revelacoes: [] };
        sala.nevoa.revelacoes = []; agendarSalvamento(codigo); io.to(codigo).emit("nevoa-atualizada", sala.nevoa); responder?.({ ok: true });
    });


    socket.on("alternar-token-oculto", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || socket.data.papel !== "Mestre" || sala.mestreId !== socket.id) return responder?.({ ok: false, mensagem: "Somente o mestre pode ocultar ou revelar tokens." });
        const item = sala.objetos.find(o => o.id === dados?.id && o.tipo === "token");
        if (!item) return responder?.({ ok: false, mensagem: "Token não encontrado." });
        item.oculto = !item.oculto; const salvoOculto=sala.bibliotecaTokens.find(t=>t.id===item.bibliotecaId); if(salvoOculto) salvoOculto.oculto=item.oculto; agendarSalvamento(codigo); emitirObjetos(codigo, sala); emitirBiblioteca(codigo, sala);
        responder?.({ ok: true, oculto: item.oculto, mensagem: item.oculto ? "Token oculto para os jogadores." : "Token revelado aos jogadores." });
    });
    socket.on("apagar-token-biblioteca", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        const indice = sala.bibliotecaTokens.findIndex(t => t.id === dados?.id);
        if (indice < 0) return responder?.({ ok: false, mensagem: "Token salvo não encontrado." });
        const [removido] = sala.bibliotecaTokens.splice(indice, 1); marcarImagemOrfa(sala, removido.chave);
        sala.objetos.forEach(o => { if (o.bibliotecaId === removido.id) delete o.bibliotecaId; });
        agendarSalvamento(codigo); emitirBiblioteca(codigo, sala); emitirObjetos(codigo, sala);
        responder?.({ ok: true, mensagem: `“${removido.nome}” foi removido da biblioteca. Tokens já colocados no mapa foram mantidos.` });
    });
    socket.on("editar-nevoa-manual", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || socket.data.papel !== "Mestre" || sala.mestreId !== socket.id) return responder?.({ ok: false, mensagem: "Somente o mestre pode editar a nevoa manual." });
        const marcas = Array.isArray(dados?.marcas) ? dados.marcas : [];
        if (marcas.length > 1500) return responder?.({ ok: false, mensagem: "Muitas marcas de uma vez." });
        const validas = marcas.filter(m => Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.raio) && Math.abs(m.x) < 10000 && Math.abs(m.y) < 8000 && m.raio >= 5 && m.raio <= 500 && ["cobrir", "revelar"].includes(m.tipo)).map(m => ({x:m.x,y:m.y,raio:m.raio,tipo:m.tipo,forma:m.forma==="quadrado"?"quadrado":"circulo"}));
        sala.nevoa = sala.nevoa || { ativada: true, raioFt: 60, modoExploracao: "persistente", revelacoes: [], marcasManuais: [] };
        sala.nevoa.marcasManuais = [...(sala.nevoa.marcasManuais || []), ...validas].slice(-5000);
        sala.nevoa.ativada = true; agendarSalvamento(codigo); io.to(codigo).emit("nevoa-atualizada", sala.nevoa); responder?.({ ok: true });
    });

    socket.on("salvar-paredes-nevoa", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || socket.data.papel !== "Mestre" || sala.mestreId !== socket.id) return responder?.({ ok: false, mensagem: "Somente o Mestre pode editar as paredes de visão." });
        const paredes = Array.isArray(dados?.paredes) ? dados.paredes.filter(w => w && [w.x1,w.y1,w.x2,w.y2].every(v => Number.isFinite(v) && v >= 0 && v <= 10000) && Math.hypot(w.x2-w.x1,w.y2-w.y1) >= 3).map(w => ({x1:w.x1,y1:w.y1,x2:w.x2,y2:w.y2,aberta:Boolean(w.aberta)})).slice(-1000) : [];
        sala.nevoa = sala.nevoa || { ativada: true, raioFt: 60, modoExploracao: "dinamica", revelacoes: [], marcasManuais: [], paredes: [] };
        sala.nevoa.paredes = paredes; agendarSalvamento(codigo); io.to(codigo).emit("nevoa-atualizada", sala.nevoa); responder?.({ ok: true, mensagem: "Paredes de visão atualizadas." });
    });

    socket.on("limpar-nevoa-manual", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || socket.data.papel !== "Mestre" || sala.mestreId !== socket.id) return responder?.({ ok: false, mensagem: "Somente o mestre pode limpar a nevoa manual." });
        sala.nevoa = sala.nevoa || { ativada: false, raioFt: 60, modoExploracao: "persistente", revelacoes: [], marcasManuais: [] }; sala.nevoa.marcasManuais = []; agendarSalvamento(codigo); io.to(codigo).emit("nevoa-atualizada", sala.nevoa); responder?.({ ok: true });
    });

    socket.on("salvar-areas-efeito", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || socket.data.papel !== "Mestre" || sala.mestreId !== socket.id) return responder?.({ ok:false, mensagem:"Somente o Mestre pode editar áreas de efeito." });
        const permitidos = new Set(["circulo","cone","linha","quadrado"]);
        const areas = Array.isArray(dados?.areas) ? dados.areas.filter(a => a && permitidos.has(a.tipo) && [a.x,a.y,a.tamanhoFt].every(Number.isFinite) && a.x>=0 && a.x<=10000 && a.y>=0 && a.y<=8000 && a.tamanhoFt>=5 && a.tamanhoFt<=120).slice(-200).map(a=>({id:String(a.id||"").slice(0,80),tipo:a.tipo,x:a.x,y:a.y,tamanhoFt:a.tamanhoFt,angulo:Number.isFinite(a.angulo)?a.angulo:0})) : [];
        sala.areasEfeito = areas; agendarSalvamento(codigo); io.to(codigo).emit("areas-efeito-atualizadas", areas); responder?.({ok:true});
    });

    socket.on("salvar-token-biblioteca", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        const item = sala.objetos.find(o => o.id === dados?.id && o.tipo === "token");
        if (!item) return responder?.({ ok: false, mensagem: "Selecione um token válido no cenário." });
        if (item.bibliotecaId && sala.bibliotecaTokens.some(t => t.id === item.bibliotecaId)) {
            return responder?.({ ok: true, mensagem: "Esse token já está salvo na biblioteca." });
        }
        if (!item.url && !item.dataUrl) return responder?.({ ok: false, mensagem: "A imagem do token é inválida." });
        if (sala.bibliotecaTokens.length >= MAX_TOKENS_BIBLIOTECA) return responder?.({ ok: false, mensagem: "A biblioteca de personagens está cheia. Apague algum token salvo." });
        const bibliotecaId = "personagem-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
        const tokenSalvo = { id: bibliotecaId, nome: String(item.nome || "Personagem").trim().slice(0, 40) || "Personagem", url: item.url, chave: item.chave, dataUrl: item.dataUrl, tamanhoFt: Number(item.tamanhoFt) || 5 };
        sala.bibliotecaTokens.push(tokenSalvo); item.bibliotecaId = bibliotecaId;
        agendarSalvamento(codigo); emitirObjetos(codigo, sala); emitirBiblioteca(codigo, sala);
        responder?.({ ok: true, mensagem: `“${tokenSalvo.nome}” foi salvo na biblioteca de personagens.` });
    });

    socket.on("recolocar-token", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        if (sala.objetos.length >= MAX_OBJETOS_POR_SALA) return responder?.({ ok: false, mensagem: "Limite de 40 itens por sala." });
        const salvo = sala.bibliotecaTokens.find(t => t.id === dados?.bibliotecaId);
        if (!salvo) return responder?.({ ok: false, mensagem: "Personagem não encontrado na bandeja." });
        sala.objetos.push({ id: "token-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7), bibliotecaId: salvo.id, tipo: "token", nome: salvo.nome, url: salvo.url, chave: salvo.chave, dataUrl: salvo.dataUrl, tamanhoFt: salvo.tamanhoFt || 5, left: 4960 + (sala.objetos.length % 6) * 24, top: 3980 + (sala.objetos.length % 6) * 24 });
        agendarSalvamento(codigo); emitirObjetos(codigo, sala); responder?.({ ok: true });
    });
    socket.on("renomear-objeto", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        const item = sala.objetos.find(o => o.id === dados?.id && o.tipo === "token");
        const nome = String(dados?.nome || "").trim().slice(0, 40);
        if (!item || !nome) return responder?.({ ok: false, mensagem: "Selecione um token e informe um nome." });
        item.nome = nome;
        const salvo = sala.bibliotecaTokens.find(t => t.id === item.bibliotecaId);
        if (salvo) salvo.nome = nome;
        agendarSalvamento(codigo); if (!item.oculto) io.to(codigo).emit("objeto-renomeado", { id: item.id, nome }); else if (sala.mestreId) io.to(sala.mestreId).emit("objeto-renomeado", { id: item.id, nome }); emitirBiblioteca(codigo, sala); responder?.({ ok: true, mensagem: "Nome do personagem salvo." });
    });
    socket.on("definir-visao-token", (dados, responder) => {
        const codigo=socket.data.codigoSala, sala=salas.get(codigo);
        if(!ehParticipante(socket,sala) || socket.data.papel!=="Mestre" || sala.mestreId!==socket.id) return responder?.({ok:false,mensagem:"Somente o Mestre pode configurar o alcance de visão."});
        const item=sala.objetos.find(o=>o.id===dados?.id && o.tipo==="token"); const visaoFt=Number(dados?.visaoFt);
        if(!item || ![30,60,90,120].includes(visaoFt)) return responder?.({ok:false,mensagem:"Selecione um token e um alcance válido."});
        item.visaoFt=visaoFt; agendarSalvamento(codigo); if(!item.oculto) io.to(codigo).emit("visao-token-atualizada",{id:item.id,visaoFt}); else io.to(sala.mestreId).emit("visao-token-atualizada",{id:item.id,visaoFt});
        responder?.({ok:true});
    });
    socket.on("alternar-bloqueio-mapa", (bloqueado, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        if (socket.data.papel !== "Mestre" || sala.mestreId !== socket.id) return responder?.({ ok: false, mensagem: "Somente o mestre pode bloquear ou desbloquear o mapa." });
        sala.mapaBloqueado = Boolean(bloqueado);
        agendarSalvamento(codigo);
        io.to(codigo).emit("bloqueio-mapa-atualizado", sala.mapaBloqueado);
        responder?.({ ok: true, mensagem: sala.mapaBloqueado ? "Mapa bloqueado para jogadores." : "Mapa desbloqueado." });
    });
    socket.on("salvar-campanha", async (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        // Grava agora e só diz "salva" se a gravação realmente deu certo (antes respondia ok mesmo se falhasse).
        const salvou = await salvarSala(codigo, { forcar: true });
        responder?.(salvou ? { ok: true, mensagem: "Campanha salva." } : { ok: false, mensagem: "Não consegui salvar agora. Vou tentar de novo automaticamente em alguns segundos." });
    });
    socket.on("salvar-visualizacao", dados => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || !dados) return;
        sala.view = { zoom: Math.max(.2, Math.min(5, Number(dados.zoom) || 1)), posX: Math.max(-100000, Math.min(100000, Number(dados.posX) || 0)), posY: Math.max(-100000, Math.min(100000, Number(dados.posY) || 0)) };
        agendarSalvamento(codigo);
    });

    socket.on("mover-objeto", dados => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || !dados || typeof dados.id !== "string") return;
        if (!Number.isFinite(dados.left) || !Number.isFinite(dados.top) || Math.abs(dados.left) > 100000 || Math.abs(dados.top) > 100000) return;
        const objeto = sala.objetos.find(item => item.id === dados.id); if (!objeto) return;
        if (sala.mapaBloqueado && objeto.tipo === "mapa") return;
        objeto.left = dados.left; objeto.top = dados.top;
        if (objeto.tipo === "token" && sala.nevoa?.ativada && sala.nevoa.modoExploracao !== "dinamica") {
            const larguraToken = Math.max(8, sala.gradePx * ((Number(objeto.tamanhoFt) || sala.pesPorQuadrado || 5) / (sala.pesPorQuadrado || 5)));
            sala.nevoa.revelacoes = Array.isArray(sala.nevoa.revelacoes) ? sala.nevoa.revelacoes : [];
            sala.nevoa.revelacoes.push({ x: objeto.left + larguraToken / 2, y: objeto.top + larguraToken / 2, raioFt: sala.nevoa.raioFt });
            if (sala.nevoa.revelacoes.length > 2000) sala.nevoa.revelacoes = sala.nevoa.revelacoes.slice(-2000);
            io.to(codigo).emit("nevoa-atualizada", sala.nevoa);
        } else if (objeto.tipo === "token" && sala.nevoa?.ativada && sala.nevoa.modoExploracao === "dinamica") {
            io.to(codigo).emit("nevoa-atualizada", sala.nevoa);
        }
        agendarSalvamento(codigo);
        if (!objeto.oculto) io.to(codigo).emit("objeto-movido", { id: objeto.id, left: objeto.left, top: objeto.top }); else if (sala.mestreId) io.to(sala.mestreId).emit("objeto-movido", { id: objeto.id, left: objeto.left, top: objeto.top });
    });
    socket.on("rotacionar-objeto", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || !dados || typeof dados.id !== "string") return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        const objeto = sala.objetos.find(item => item.id === dados.id && item.tipo === "token");
        const rotacao = Number(dados.rotacao);
        if (!objeto || !Number.isFinite(rotacao) || rotacao < 0 || rotacao >= 360) return responder?.({ ok: false, mensagem: "Rotação de token inválida." });
        objeto.rotacao = Math.round(rotacao / 15) * 15 % 360;
        agendarSalvamento(codigo);
        if (!objeto.oculto) io.to(codigo).emit("objeto-rotacionado", { id: objeto.id, rotacao: objeto.rotacao });
        else if (sala.mestreId) io.to(sala.mestreId).emit("objeto-rotacionado", { id: objeto.id, rotacao: objeto.rotacao });
        responder?.({ ok: true, rotacao: objeto.rotacao });
    });

    socket.on("redimensionar-objeto", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || !dados || typeof dados.id !== "string") return responder?.({ ok: false, mensagem: "Você precisa estar em uma sala." });
        const objeto = sala.objetos.find(item => item.id === dados.id);
        if (!objeto) return responder?.({ ok: false, mensagem: "Item não encontrado." });
        const atualizacao = { id: objeto.id };
        if (objeto.tipo === "token") {
            const tamanhoFt = Number(dados.tamanhoFt);
            if (!Number.isFinite(tamanhoFt) || tamanhoFt < 5 || tamanhoFt > 200) return responder?.({ ok: false, mensagem: "Escolha um tamanho de token entre 5 e 200 ft." });
            objeto.tamanhoFt = Math.round(tamanhoFt / 5) * 5; atualizacao.tamanhoFt = objeto.tamanhoFt;
        } else {
            const largura = Number(dados.largura);
            if (!Number.isFinite(largura) || largura < 24 || largura > 5000) return responder?.({ ok: false, mensagem: "A largura deve ficar entre 24 e 5000 pixels." });
            objeto.largura = Math.round(largura); atualizacao.largura = objeto.largura;
        }
        agendarSalvamento(codigo); if (!objeto.oculto) io.to(codigo).emit("objeto-redimensionado", atualizacao); else if (sala.mestreId) io.to(sala.mestreId).emit("objeto-redimensionado", atualizacao);
        responder?.({ ok: true });
    });
    socket.on("alterar-grade-visual", dados => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return;
        const gradePx = Number(dados?.gradePx);
        if (!Number.isFinite(gradePx) || gradePx < 8 || gradePx > 180) return;
        sala.gradePx = Math.round(gradePx * 10) / 10; agendarSalvamento(codigo);
        io.to(codigo).emit("grade-visual-atualizada", { gradePx: sala.gradePx, gradeX: sala.gradeX, gradeY: sala.gradeY });
    });
    socket.on("calibrar-grade-mapa", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        const objeto = sala.objetos.find(item => item.id === dados?.id && item.tipo === "mapa");
        const g = dados?.gradeDetectada;
        if (!objeto || !g || !Number.isFinite(Number(g.gradePx))) return responder?.({ ok: false, mensagem: "Selecione um mapa válido." });
        sala.gradePx = Math.max(8, Math.min(180, Number(g.gradePx)));
        sala.gradeX = Number(objeto.left) + Math.max(0, Math.min(Number(objeto.largura) || 900, Number(g.faseX) || 0));
        sala.gradeY = Number(objeto.top) + Math.max(0, Math.min(Number(objeto.largura) || 900, Number(g.faseY) || 0)); agendarSalvamento(codigo);
        io.to(codigo).emit("grade-visual-atualizada", { gradePx: sala.gradePx, gradeX: sala.gradeX, gradeY: sala.gradeY });
        responder?.({ ok: true, mensagem: "Tentei alinhar a grade ao mapa. Confira e ajuste com +Grade/-Grade se necessário." });
    });
    socket.on("alterar-escala-grade", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        const pesPorQuadrado = Number(dados?.pesPorQuadrado);
        if (!Number.isFinite(pesPorQuadrado) || pesPorQuadrado < 1 || pesPorQuadrado > 100) return responder?.({ ok: false, mensagem: "A grade deve representar entre 1 e 100 pés por quadrado." });
        sala.pesPorQuadrado = pesPorQuadrado; agendarSalvamento(codigo);
        io.to(codigo).emit("escala-grade-atualizada", { pesPorQuadrado });
        responder?.({ ok: true });
    });
    socket.on("apagar-objeto", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala antes de apagar itens." });
        if (!dados || typeof dados.id !== "string") return responder?.({ ok: false, mensagem: "Item inválido." });
        const indice = sala.objetos.findIndex(item => item.id === dados.id);
        if (indice === -1) return responder?.({ ok: false, mensagem: "Esse item não existe mais no cenário." });
        const [objetoRemovido] = sala.objetos.splice(indice, 1); marcarImagemOrfa(sala, objetoRemovido?.chave); agendarSalvamento(codigo);
        emitirObjetos(codigo, sala);
        responder?.({ ok: true, mensagem: "Item apagado para todos na sala." });
    });
    socket.on("rolar-dados", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala antes de rolar dados." });
        try {
            const nome = sala.participantes.get(socket.id)?.nome || "Participante";
            const expressao = String(dados?.expressao || "").trim();
            const calculo = parsearExpressao(expressao, dados?.bonus);
            const resultado = { nome, expressao, ...calculo, timestamp: Date.now() };
            io.to(codigo).emit("rolagem-realizada", resultado); responder?.({ ok: true });
        } catch (erro) { responder?.({ ok: false, mensagem: erro.message || "Não foi possível rolar os dados." }); }
    });
    socket.on("disconnect", () => {
        const codigo = socket.data.codigoSala; if (!codigo) return;
        const sala = salas.get(codigo); if (!sala) return;
        const eraMestre = sala.mestreId === socket.id;
        sala.participantes.delete(socket.id);
        if (eraMestre) {
            // Antes: o Mestre cair (Wi-Fi, F5, reinício do servidor) encerrava a mesa e expulsava todo mundo.
            // Agora a sala continua aberta, o Mestre volta com a Chave dele e retoma de onde parou.
            sala.mestreId = null; io.to(codigo).emit("mestre-ausente");
        }
        atualizarParticipantes(codigo);
        agendarSalvamento(codigo);
        if (sala.participantes.size === 0) agendarEvicao(codigo);
        console.log((eraMestre ? "Mestre" : "Participante") + " saiu da sala:", codigo);
    });
});

// ---------- Inicialização e desligamento ----------
function avisosDeAmbiente() {
    if (!process.env.RENDER) return;
    if (store.nome === "arquivo") console.warn("\n⚠️  ATENÇÃO: DATABASE_URL não está definido. As campanhas estão sendo gravadas no disco do Render, que é APAGADO a cada reinício. Veja GUIA-DEPLOY.md.\n");
    if (storage.nome === "local") console.warn("\n⚠️  ATENÇÃO: CLOUDINARY_URL não está definido. As imagens estão sendo gravadas no disco do Render, que é APAGADO a cada reinício. Veja GUIA-DEPLOY.md.\n");
}

async function iniciar() {
    store = await criarStore(); storage = criarStorage();
    avisosDeAmbiente();
    await new Promise(resolver => servidor.listen(PORTA, "0.0.0.0", resolver));
    console.log(`Mesa de RPG disponível na porta ${PORTA} (campanhas: ${store.nome} | imagens: ${storage.nome})`);
}

// O Render envia SIGTERM antes de reiniciar/desligar: grava tudo que estiver pendente e sai.
let encerrando = false;
async function encerrar(sinal) {
    if (encerrando) return; encerrando = true;
    console.log(`${sinal} recebido: salvando as salas antes de sair...`);
    setTimeout(() => process.exit(1), 10000).unref();
    try { await Promise.allSettled([...salas.keys()].map(codigo => salvarSala(codigo))); await store.fechar?.(); } catch (erro) { console.error(erro.message); }
    process.exit(0);
}
process.on("SIGTERM", () => encerrar("SIGTERM"));
process.on("SIGINT", () => encerrar("SIGINT"));

if (require.main === module) iniciar().catch(erro => { console.error("Falha ao iniciar:", erro); process.exit(1); });
module.exports = { iniciar };
