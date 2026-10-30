const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const app = express();
const servidor = http.createServer(app);
const io = new Server(servidor, { maxHttpBufferSize: 16 * 1024 * 1024 });
app.use(express.static(__dirname));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
const salas = new Map();
const ARQUIVO_CAMPANHAS = path.join(__dirname, "campanhas-salvas.json");
function salvarCampanhas() {
    try {
        const dados = {};
        for (const [codigo, sala] of salas) dados[codigo] = {
            objetos: sala.objetos || [], areasEfeito: sala.areasEfeito || [], bibliotecaTokens: sala.bibliotecaTokens || [], desenhos: sala.desenhos || [], nevoa: sala.nevoa || { ativada: false, raioFt: 60, modoExploracao: "persistente", revelacoes: [], marcasManuais: [] },
            pesPorQuadrado: sala.pesPorQuadrado || 5, gradePx: sala.gradePx || 32,
            gradeX: Number.isFinite(sala.gradeX) ? sala.gradeX : 5000,
            gradeY: Number.isFinite(sala.gradeY) ? sala.gradeY : 4000,
            view: sala.view || { zoom: 1, posX: 0, posY: 0 }, mapaBloqueado: Boolean(sala.mapaBloqueado)
        };
        fs.writeFileSync(ARQUIVO_CAMPANHAS, JSON.stringify(dados), "utf8");
    } catch (erro) { console.error("Não foi possível salvar as campanhas:", erro.message); }
}
function carregarCampanhas() {
    try {
        if (!fs.existsSync(ARQUIVO_CAMPANHAS)) return;
        const dados = JSON.parse(fs.readFileSync(ARQUIVO_CAMPANHAS, "utf8"));
        for (const [codigo, salvo] of Object.entries(dados)) salas.set(codigo, {
            mestreId: null, participantes: new Map(), objetos: Array.isArray(salvo.objetos) ? salvo.objetos : [], areasEfeito: Array.isArray(salvo.areasEfeito) ? salvo.areasEfeito : [],
            bibliotecaTokens: Array.isArray(salvo.bibliotecaTokens) ? salvo.bibliotecaTokens : [], desenhos: Array.isArray(salvo.desenhos) ? salvo.desenhos : [], nevoa: salvo.nevoa && typeof salvo.nevoa === "object" ? { ativada: Boolean(salvo.nevoa.ativada), raioFt: [30,60,90,120].includes(Number(salvo.nevoa.raioFt)) ? Number(salvo.nevoa.raioFt) : 60, modoExploracao: salvo.nevoa.modoExploracao === "dinamica" ? "dinamica" : "persistente", revelacoes: Array.isArray(salvo.nevoa.revelacoes) ? salvo.nevoa.revelacoes.filter(r => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.raioFt)).slice(-2000) : [], marcasManuais: Array.isArray(salvo.nevoa.marcasManuais) ? salvo.nevoa.marcasManuais.filter(r => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.raio)).map(r => ({x:r.x,y:r.y,raio:r.raio,tipo:r.tipo==="revelar"?"revelar":"cobrir",forma:r.forma==="quadrado"?"quadrado":"circulo"})).slice(-5000) : [], paredes: Array.isArray(salvo.nevoa.paredes) ? salvo.nevoa.paredes.filter(w => [w.x1,w.y1,w.x2,w.y2].every(Number.isFinite)).map(w => ({x1:w.x1,y1:w.y1,x2:w.x2,y2:w.y2,aberta:Boolean(w.aberta)})).slice(-1000) : [] } : { ativada: false, raioFt: 60, modoExploracao: "persistente", revelacoes: [], marcasManuais: [], paredes: [] },
            pesPorQuadrado: Number(salvo.pesPorQuadrado) || 5, gradePx: Number(salvo.gradePx) || 32,
            gradeX: Number.isFinite(salvo.gradeX) ? salvo.gradeX : 5000,
            gradeY: Number.isFinite(salvo.gradeY) ? salvo.gradeY : 4000,
            view: salvo.view || { zoom: 1, posX: 0, posY: 0 }, mapaBloqueado: Boolean(salvo.mapaBloqueado)
        });
        console.log(`Campanhas salvas carregadas: ${salas.size}`);
    } catch (erro) { console.error("Arquivo de campanhas não pôde ser lido:", erro.message); }
}
carregarCampanhas();
const TIPOS_IMAGEM = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_MAPA_CARACTERES = 6 * 1024 * 1024;
const MAX_TOKEN_CARACTERES = 450 * 1024;
const MAX_OBJETOS_POR_SALA = 40;

function gerarCodigo() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let codigo;
    do { codigo = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""); } while (salas.has(codigo));
    return codigo;
}
function imagemValida(dataUrl, limite) {
    if (typeof dataUrl !== "string" || dataUrl.length > limite) return false;
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    return Boolean(match && TIPOS_IMAGEM.includes(match[1]));
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

io.on("connection", socket => {
    console.log("Conexão recebida:", socket.id);
    socket.on("criar-sala", (dados, responder) => {
        if (socket.data.codigoSala) return responder?.({ ok: false, mensagem: "Você já está em uma sala." });
        const nome = String(dados?.nome || "").trim().slice(0, 24);
        if (!nome) return responder?.({ ok: false, mensagem: "Digite seu nome." });
        const codigo = gerarCodigo();
        const sala = { mestreId: socket.id, participantes: new Map(), objetos: [], areasEfeito: [], bibliotecaTokens: [], desenhos: [], nevoa: { ativada: false, raioFt: 60, modoExploracao: "persistente", revelacoes: [], marcasManuais: [], paredes: [] }, pesPorQuadrado: 5, gradePx: 32, gradeX: 5000, gradeY: 4000, view: { zoom: 1, posX: 0, posY: 0 }, mapaBloqueado: false };
        sala.participantes.set(socket.id, { nome, papel: "Mestre" }); salas.set(codigo, sala); salvarCampanhas();
        socket.join(codigo); socket.data.codigoSala = codigo; socket.data.papel = "Mestre";
        responder?.({ ok: true, codigo, papel: "Mestre", mensagem: "Sala criada. A campanha é salva automaticamente neste servidor." }); socket.emit("estado-cenario", { objetos: objetosVisiveisPara(socket, sala), areasEfeito: sala.areasEfeito || [], bibliotecaTokens: bibliotecaVisivelPara(socket, sala), desenhos: sala.desenhos, nevoa: sala.nevoa, mapaBloqueado: Boolean(sala.mapaBloqueado), pesPorQuadrado: sala.pesPorQuadrado, gradePx: sala.gradePx, gradeX: sala.gradeX, gradeY: sala.gradeY, view: sala.view }); atualizarParticipantes(codigo);
        console.log("Sala criada:", codigo);
    });
    socket.on("entrar-sala", (dados, responder) => {
        if (socket.data.codigoSala) return responder?.({ ok: false, mensagem: "Você já está em uma sala." });
        const nome = String(dados?.nome || "").trim().slice(0, 24), codigo = String(dados?.codigo || "").trim().toUpperCase();
        if (!nome || !codigo) return responder?.({ ok: false, mensagem: "Digite seu nome e o código da sala." });
        const sala = salas.get(codigo); if (!sala) return responder?.({ ok: false, mensagem: "Sala não encontrada. Confira o código." });
        const papel = sala.participantes.size === 0 ? "Mestre" : "Jogador";
        if (papel === "Mestre" && dados?.papelEsperado === "Jogador") return responder?.({ ok: false, aguardarMestre: true, mensagem: "Aguardando o Mestre retomar a sala." });
        if (papel === "Mestre") sala.mestreId = socket.id;
        sala.participantes.set(socket.id, { nome, papel }); socket.join(codigo);
        socket.data.codigoSala = codigo; socket.data.papel = papel;
        responder?.({ ok: true, codigo, papel, mensagem: papel === "Mestre" ? "Campanha carregada. Você retomou como mestre." : "Conectado à campanha salva." });
        socket.emit("estado-cenario", { objetos: objetosVisiveisPara(socket, sala), areasEfeito: sala.areasEfeito || [], bibliotecaTokens: bibliotecaVisivelPara(socket, sala), desenhos: sala.desenhos, nevoa: sala.nevoa, mapaBloqueado: Boolean(sala.mapaBloqueado), pesPorQuadrado: sala.pesPorQuadrado, gradePx: sala.gradePx, gradeX: sala.gradeX, gradeY: sala.gradeY, view: sala.view }); atualizarParticipantes(codigo);
        console.log(nome + " entrou na sala " + codigo);
    });
    socket.on("adicionar-imagem", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Você precisa estar em uma sala." });
        if (!imagemValida(dados?.dataUrl, MAX_MAPA_CARACTERES)) return responder?.({ ok: false, mensagem: "Imagem inválida ou muito grande. Use PNG/JPG/WEBP/GIF de até 4 MB." });
        if (sala.objetos.length >= MAX_OBJETOS_POR_SALA) return responder?.({ ok: false, mensagem: "Limite de 40 itens por sala." });
        const tipo = dados.tipo === "mapa" ? "mapa" : "imagem";
        const largura = tipo === "mapa" ? 900 : 600;
        const left = 4760 + (sala.objetos.length % 5) * 90, top = 3600 + (sala.objetos.length % 5) * 65;
        const objeto = { id: "imagem-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7), tipo, nome: dados.nome || "Imagem", dataUrl: dados.dataUrl, largura, left, top };
        if (tipo === "mapa" && dados.gradeDetectada && Number.isFinite(Number(dados.gradeDetectada.gradePx))) {
            const g = dados.gradeDetectada;
            sala.gradePx = Math.max(8, Math.min(180, Number(g.gradePx)));
            sala.gradeX = left + Math.max(0, Math.min(largura, Number(g.faseX) || 0));
            sala.gradeY = top + Math.max(0, Math.min(largura, Number(g.faseY) || 0));
        }
        sala.objetos.push(objeto); salvarCampanhas();
        io.to(codigo).emit("grade-visual-atualizada", { gradePx: sala.gradePx, gradeX: sala.gradeX, gradeY: sala.gradeY });
        emitirObjetos(codigo, sala);
        responder?.({ ok: true, mensagem: tipo === "mapa" && dados.gradeDetectada ? "Mapa adicionado. Tentei detectar a grade automaticamente; confira o alinhamento e use +Grade/-Grade para corrigir." : "Imagem adicionada e compartilhada com a sala!" });
    });
    socket.on("adicionar-token", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Você precisa estar em uma sala." });
        if (!imagemValida(dados?.dataUrl, MAX_TOKEN_CARACTERES)) return responder?.({ ok: false, mensagem: "Token inválido ou muito grande. Use PNG/JPG/WEBP/GIF de até 300 KB." });
        if (sala.objetos.length >= MAX_OBJETOS_POR_SALA) return responder?.({ ok: false, mensagem: "Limite de 40 itens por sala." });
        const bibliotecaId = "personagem-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
        const tokenSalvo = { id: bibliotecaId, nome: String(dados.nome || "Personagem").trim().slice(0, 40) || "Personagem", dataUrl: dados.dataUrl, tamanhoFt: 5 };
        sala.bibliotecaTokens.push(tokenSalvo);
        sala.objetos.push({ id: "token-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7), bibliotecaId, tipo: "token", nome: tokenSalvo.nome, dataUrl: dados.dataUrl, tamanhoFt: 5, left: 4960 + (sala.objetos.length % 6) * 18, top: 3980 + (sala.objetos.length % 6) * 18 });
        salvarCampanhas(); emitirObjetos(codigo, sala); emitirBiblioteca(codigo, sala); responder?.({ ok: true, mensagem: "Token adicionado e salvo na bandeja de personagens!" });
    });
    socket.on("adicionar-desenho", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        if (!Array.isArray(dados?.pontos) || dados.pontos.length < 2 || dados.pontos.length > 2500) return responder?.({ ok: false, mensagem: "Desenho inválido." });
        const pontos = dados.pontos.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 15000 && Math.abs(p.y) <= 12000).map(p => ({ x: p.x, y: p.y }));
        if (pontos.length < 2) return responder?.({ ok: false, mensagem: "Desenho sem pontos suficientes." });
        sala.desenhos.push({ id: "desenho-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6), pontos, cor: "#ffdf70", largura: 3 });
        if (sala.desenhos.length > 200) sala.desenhos.shift();
        salvarCampanhas(); io.to(codigo).emit("desenhos-atualizados", sala.desenhos); responder?.({ ok: true });
    });
    socket.on("limpar-desenhos", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        sala.desenhos = []; salvarCampanhas(); io.to(codigo).emit("desenhos-atualizados", sala.desenhos); responder?.({ ok: true });
    });
    socket.on("apagar-desenho", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        const indice = sala.desenhos.findIndex(d => d.id === dados?.id);
        if (indice < 0) return responder?.({ ok: false, mensagem: "Traço não encontrado." });
        sala.desenhos.splice(indice, 1); salvarCampanhas(); io.to(codigo).emit("desenhos-atualizados", sala.desenhos); responder?.({ ok: true });
    });
    socket.on("configurar-nevoa", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || socket.data.papel !== "Mestre") return responder?.({ ok: false, mensagem: "Somente o mestre pode configurar a escuridão." });
        const ativada = Boolean(dados?.ativada), raioFt = Number(dados?.raioFt);
        if (![30, 60, 90, 120].includes(raioFt)) return responder?.({ ok: false, mensagem: "Escolha um alcance válido." });
        sala.nevoa = sala.nevoa || { ativada: false, raioFt: 60, revelacoes: [] };
        sala.nevoa.ativada = ativada; sala.nevoa.raioFt = raioFt; sala.nevoa.modoExploracao = dados?.modoExploracao === "dinamica" ? "dinamica" : "persistente"; if (sala.nevoa.modoExploracao === "dinamica") sala.nevoa.revelacoes = []; sala.nevoa.marcasManuais = Array.isArray(sala.nevoa.marcasManuais) ? sala.nevoa.marcasManuais : []; sala.nevoa.paredes = Array.isArray(sala.nevoa.paredes) ? sala.nevoa.paredes : [];
        salvarCampanhas(); io.to(codigo).emit("nevoa-atualizada", sala.nevoa); responder?.({ ok: true });
    });
    socket.on("limpar-revelacao-nevoa", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || socket.data.papel !== "Mestre") return responder?.({ ok: false, mensagem: "Somente o mestre pode reiniciar a escuridão." });
        sala.nevoa = sala.nevoa || { ativada: false, raioFt: 60, revelacoes: [] };
        sala.nevoa.revelacoes = []; salvarCampanhas(); io.to(codigo).emit("nevoa-atualizada", sala.nevoa); responder?.({ ok: true });
    });


    socket.on("alternar-token-oculto", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || socket.data.papel !== "Mestre" || sala.mestreId !== socket.id) return responder?.({ ok: false, mensagem: "Somente o mestre pode ocultar ou revelar tokens." });
        const item = sala.objetos.find(o => o.id === dados?.id && o.tipo === "token");
        if (!item) return responder?.({ ok: false, mensagem: "Token não encontrado." });
        item.oculto = !item.oculto; const salvoOculto=sala.bibliotecaTokens.find(t=>t.id===item.bibliotecaId); if(salvoOculto) salvoOculto.oculto=item.oculto; salvarCampanhas(); emitirObjetos(codigo, sala); emitirBiblioteca(codigo, sala);
        responder?.({ ok: true, oculto: item.oculto, mensagem: item.oculto ? "Token oculto para os jogadores." : "Token revelado aos jogadores." });
    });
    socket.on("apagar-token-biblioteca", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        const indice = sala.bibliotecaTokens.findIndex(t => t.id === dados?.id);
        if (indice < 0) return responder?.({ ok: false, mensagem: "Token salvo não encontrado." });
        const [removido] = sala.bibliotecaTokens.splice(indice, 1);
        sala.objetos.forEach(o => { if (o.bibliotecaId === removido.id) delete o.bibliotecaId; });
        salvarCampanhas(); emitirBiblioteca(codigo, sala); emitirObjetos(codigo, sala);
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
        sala.nevoa.ativada = true; salvarCampanhas(); io.to(codigo).emit("nevoa-atualizada", sala.nevoa); responder?.({ ok: true });
    });

    socket.on("salvar-paredes-nevoa", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || socket.data.papel !== "Mestre" || sala.mestreId !== socket.id) return responder?.({ ok: false, mensagem: "Somente o Mestre pode editar as paredes de visão." });
        const paredes = Array.isArray(dados?.paredes) ? dados.paredes.filter(w => w && [w.x1,w.y1,w.x2,w.y2].every(v => Number.isFinite(v) && v >= 0 && v <= 10000) && Math.hypot(w.x2-w.x1,w.y2-w.y1) >= 3).map(w => ({x1:w.x1,y1:w.y1,x2:w.x2,y2:w.y2,aberta:Boolean(w.aberta)})).slice(-1000) : [];
        sala.nevoa = sala.nevoa || { ativada: true, raioFt: 60, modoExploracao: "dinamica", revelacoes: [], marcasManuais: [], paredes: [] };
        sala.nevoa.paredes = paredes; salvarCampanhas(); io.to(codigo).emit("nevoa-atualizada", sala.nevoa); responder?.({ ok: true, mensagem: "Paredes de visão atualizadas." });
    });

    socket.on("limpar-nevoa-manual", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || socket.data.papel !== "Mestre" || sala.mestreId !== socket.id) return responder?.({ ok: false, mensagem: "Somente o mestre pode limpar a nevoa manual." });
        sala.nevoa = sala.nevoa || { ativada: false, raioFt: 60, modoExploracao: "persistente", revelacoes: [], marcasManuais: [] }; sala.nevoa.marcasManuais = []; salvarCampanhas(); io.to(codigo).emit("nevoa-atualizada", sala.nevoa); responder?.({ ok: true });
    });

    socket.on("salvar-areas-efeito", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || socket.data.papel !== "Mestre" || sala.mestreId !== socket.id) return responder?.({ ok:false, mensagem:"Somente o Mestre pode editar áreas de efeito." });
        const permitidos = new Set(["circulo","cone","linha","quadrado"]);
        const areas = Array.isArray(dados?.areas) ? dados.areas.filter(a => a && permitidos.has(a.tipo) && [a.x,a.y,a.tamanhoFt].every(Number.isFinite) && a.x>=0 && a.x<=10000 && a.y>=0 && a.y<=8000 && a.tamanhoFt>=5 && a.tamanhoFt<=120).slice(-200).map(a=>({id:String(a.id||"").slice(0,80),tipo:a.tipo,x:a.x,y:a.y,tamanhoFt:a.tamanhoFt,angulo:Number.isFinite(a.angulo)?a.angulo:0})) : [];
        sala.areasEfeito = areas; salvarCampanhas(); io.to(codigo).emit("areas-efeito-atualizadas", areas); responder?.({ok:true});
    });

    socket.on("salvar-token-biblioteca", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        const item = sala.objetos.find(o => o.id === dados?.id && o.tipo === "token");
        if (!item) return responder?.({ ok: false, mensagem: "Selecione um token válido no cenário." });
        if (item.bibliotecaId && sala.bibliotecaTokens.some(t => t.id === item.bibliotecaId)) {
            return responder?.({ ok: true, mensagem: "Esse token já está salvo na biblioteca." });
        }
        if (!imagemValida(item.dataUrl, MAX_TOKEN_CARACTERES)) return responder?.({ ok: false, mensagem: "A imagem do token é inválida ou muito grande para a biblioteca." });
        const bibliotecaId = "personagem-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
        const tokenSalvo = { id: bibliotecaId, nome: String(item.nome || "Personagem").trim().slice(0, 40) || "Personagem", dataUrl: item.dataUrl, tamanhoFt: Number(item.tamanhoFt) || 5 };
        sala.bibliotecaTokens.push(tokenSalvo); item.bibliotecaId = bibliotecaId;
        salvarCampanhas(); emitirObjetos(codigo, sala); emitirBiblioteca(codigo, sala);
        responder?.({ ok: true, mensagem: `“${tokenSalvo.nome}” foi salvo na biblioteca de personagens.` });
    });

    socket.on("recolocar-token", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        if (sala.objetos.length >= MAX_OBJETOS_POR_SALA) return responder?.({ ok: false, mensagem: "Limite de 40 itens por sala." });
        const salvo = sala.bibliotecaTokens.find(t => t.id === dados?.bibliotecaId);
        if (!salvo) return responder?.({ ok: false, mensagem: "Personagem não encontrado na bandeja." });
        sala.objetos.push({ id: "token-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7), bibliotecaId: salvo.id, tipo: "token", nome: salvo.nome, dataUrl: salvo.dataUrl, tamanhoFt: salvo.tamanhoFt || 5, left: 4960 + (sala.objetos.length % 6) * 24, top: 3980 + (sala.objetos.length % 6) * 24 });
        salvarCampanhas(); emitirObjetos(codigo, sala); responder?.({ ok: true });
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
        salvarCampanhas(); if (!item.oculto) io.to(codigo).emit("objeto-renomeado", { id: item.id, nome }); else if (sala.mestreId) io.to(sala.mestreId).emit("objeto-renomeado", { id: item.id, nome }); emitirBiblioteca(codigo, sala); responder?.({ ok: true, mensagem: "Nome do personagem salvo." });
    });
    socket.on("definir-visao-token", (dados, responder) => {
        const codigo=socket.data.codigoSala, sala=salas.get(codigo);
        if(!ehParticipante(socket,sala) || socket.data.papel!=="Mestre" || sala.mestreId!==socket.id) return responder?.({ok:false,mensagem:"Somente o Mestre pode configurar o alcance de visão."});
        const item=sala.objetos.find(o=>o.id===dados?.id && o.tipo==="token"); const visaoFt=Number(dados?.visaoFt);
        if(!item || ![30,60,90,120].includes(visaoFt)) return responder?.({ok:false,mensagem:"Selecione um token e um alcance válido."});
        item.visaoFt=visaoFt; salvarCampanhas(); if(!item.oculto) io.to(codigo).emit("visao-token-atualizada",{id:item.id,visaoFt}); else io.to(sala.mestreId).emit("visao-token-atualizada",{id:item.id,visaoFt});
        responder?.({ok:true});
    });
    socket.on("alternar-bloqueio-mapa", (bloqueado, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        if (socket.data.papel !== "Mestre" || sala.mestreId !== socket.id) return responder?.({ ok: false, mensagem: "Somente o mestre pode bloquear ou desbloquear o mapa." });
        sala.mapaBloqueado = Boolean(bloqueado);
        salvarCampanhas();
        io.to(codigo).emit("bloqueio-mapa-atualizado", sala.mapaBloqueado);
        responder?.({ ok: true, mensagem: sala.mapaBloqueado ? "Mapa bloqueado para jogadores." : "Mapa desbloqueado." });
    });
    socket.on("salvar-campanha", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        salvarCampanhas(); responder?.({ ok: true, mensagem: "Campanha salva." });
    });
    socket.on("salvar-visualizacao", dados => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || !dados) return;
        sala.view = { zoom: Math.max(.2, Math.min(5, Number(dados.zoom) || 1)), posX: Math.max(-100000, Math.min(100000, Number(dados.posX) || 0)), posY: Math.max(-100000, Math.min(100000, Number(dados.posY) || 0)) };
        salvarCampanhas();
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
        salvarCampanhas();
        if (!objeto.oculto) io.to(codigo).emit("objeto-movido", { id: objeto.id, left: objeto.left, top: objeto.top }); else if (sala.mestreId) io.to(sala.mestreId).emit("objeto-movido", { id: objeto.id, left: objeto.left, top: objeto.top });
    });
    socket.on("rotacionar-objeto", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala) || !dados || typeof dados.id !== "string") return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        const objeto = sala.objetos.find(item => item.id === dados.id && item.tipo === "token");
        const rotacao = Number(dados.rotacao);
        if (!objeto || !Number.isFinite(rotacao) || rotacao < 0 || rotacao >= 360) return responder?.({ ok: false, mensagem: "Rotação de token inválida." });
        objeto.rotacao = Math.round(rotacao / 15) * 15 % 360;
        salvarCampanhas();
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
        salvarCampanhas(); if (!objeto.oculto) io.to(codigo).emit("objeto-redimensionado", atualizacao); else if (sala.mestreId) io.to(sala.mestreId).emit("objeto-redimensionado", atualizacao);
        responder?.({ ok: true });
    });
    socket.on("alterar-grade-visual", dados => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return;
        const gradePx = Number(dados?.gradePx);
        if (!Number.isFinite(gradePx) || gradePx < 8 || gradePx > 180) return;
        sala.gradePx = Math.round(gradePx * 10) / 10; salvarCampanhas();
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
        sala.gradeY = Number(objeto.top) + Math.max(0, Math.min(Number(objeto.largura) || 900, Number(g.faseY) || 0)); salvarCampanhas();
        io.to(codigo).emit("grade-visual-atualizada", { gradePx: sala.gradePx, gradeX: sala.gradeX, gradeY: sala.gradeY });
        responder?.({ ok: true, mensagem: "Tentei alinhar a grade ao mapa. Confira e ajuste com +Grade/-Grade se necessário." });
    });
    socket.on("alterar-escala-grade", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala primeiro." });
        const pesPorQuadrado = Number(dados?.pesPorQuadrado);
        if (!Number.isFinite(pesPorQuadrado) || pesPorQuadrado < 1 || pesPorQuadrado > 100) return responder?.({ ok: false, mensagem: "A grade deve representar entre 1 e 100 pés por quadrado." });
        sala.pesPorQuadrado = pesPorQuadrado; salvarCampanhas();
        io.to(codigo).emit("escala-grade-atualizada", { pesPorQuadrado });
        responder?.({ ok: true });
    });
    socket.on("apagar-objeto", (dados, responder) => {
        const codigo = socket.data.codigoSala, sala = salas.get(codigo);
        if (!ehParticipante(socket, sala)) return responder?.({ ok: false, mensagem: "Entre em uma sala antes de apagar itens." });
        if (!dados || typeof dados.id !== "string") return responder?.({ ok: false, mensagem: "Item inválido." });
        const indice = sala.objetos.findIndex(item => item.id === dados.id);
        if (indice === -1) return responder?.({ ok: false, mensagem: "Esse item não existe mais no cenário." });
        sala.objetos.splice(indice, 1); salvarCampanhas();
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
        if (sala.mestreId === socket.id) {
            io.to(codigo).emit("sala-encerrada");
            for (const id of sala.participantes.keys()) { const participante = io.sockets.sockets.get(id); if (participante) { participante.leave(codigo); delete participante.data.codigoSala; delete participante.data.papel; } }
            sala.participantes.clear(); sala.mestreId = null; salvarCampanhas(); console.log("Campanha salva; mestre saiu da sala:", codigo); return;
        }
        sala.participantes.delete(socket.id); salvarCampanhas(); atualizarParticipantes(codigo); console.log("Participante saiu da sala:", codigo);
    });
});
servidor.listen(3000, () => console.log("Mesa de RPG disponível em http://localhost:3000"));
