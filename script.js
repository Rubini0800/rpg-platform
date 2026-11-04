const socket = io();
const el = id => document.getElementById(id);
const campoNome = el("nomeParticipante"), campoCodigo = el("codigoSala");
const botaoCriarSala = el("criarSala"), botaoEntrarSala = el("entrarSala");
const mensagemSala = el("mensagemSala"), painelSala = el("painelSala");
const codigoExibido = el("codigoExibido"), papelExibido = el("papelExibido");
const listaParticipantes = el("listaParticipantes"), cenario = el("cenario");
const botaoCarregarMapa = el("botaoCarregarMapa"), arquivoMapa = el("arquivoMapa");
const botaoAdicionarToken = el("botaoAdicionarToken"), arquivoToken = el("arquivoToken");
const expressaoDados = el("expressaoDados"), bonusAtaque = el("bonusAtaque");
const botaoDado = el("botaoDado"), resultado = el("resultado");
const animacaoDados = el("animacaoDados"), dadoAnimado = el("dadoAnimado");
const menuObjeto = el("menuObjeto"), botaoApagarObjeto = el("apagarObjeto"), alternarVisibilidadeToken = el("alternarVisibilidadeToken");
const pesPorQuadrado = el("pesPorQuadrado"), itemSelecionadoInfo = el("itemSelecionadoInfo");
const tamanhoTokenFt = el("tamanhoTokenFt"), aplicarTamanhoToken = el("aplicarTamanhoToken");
const diminuirTamanhoItem = el("diminuirTamanhoItem"), aumentarTamanhoItem = el("aumentarTamanhoItem");
const nomeTokenSelecionado = el("nomeTokenSelecionado"), salvarNomeToken = el("salvarNomeToken");
const listaPersonagensSalvos = el("listaPersonagensSalvos");
let bibliotecaTokens = [];
let desenhos = [];
let areasEfeito = [], modoAreaEfeito = false, areaEfeitoSelecionadaId = null;
let nevoa = { ativada: false, raioFt: 60, modoExploracao: "persistente", revelacoes: [], marcasManuais: [], paredes: [] };
let modoPincelNevoa = null, desenhandoNevoa = false, marcasNevoaAtual = [];
let formatoPincelNevoa = "circulo";
let modoDesenharParedes = false, inicioParedeAtual = null, fimParedeAtual = null;
let mapaBloqueado = false;
let desenhoSelecionadoId = null;
let modoFerramenta = null, desenhandoAgora = false, pontosDesenhoAtual = [], pontoReguaInicio = null;
let tokenRotacionando = null, anguloInicialRotacao = 0;
let objetoSelecionado = null;
const textoAnimacao = el("textoAnimacao"), resultadoAnimacao = el("resultadoAnimacao");
let zoom = 1, posX = 0, posY = 0, arrastando = false;
let teclaEspacoPressionada = false;
let inicioX = 0, inicioY = 0, alvoArrastado = null, objetoX = 0, objetoY = 0;
let temporizadorAnimacao = null;
let escalaGradeFt = 5;
let gradePx = 32, gradeX = 5000, gradeY = 4000;
const TAMANHO_QUADRADO_PX = 32;

function estaEmUmaSala() { return !painelSala.hidden && Boolean(codigoExibido.textContent); }
function atualizarPermissoes() { const ativo = estaEmUmaSala(); botaoCarregarMapa.disabled = !ativo; botaoAdicionarToken.disabled = !ativo; botaoDado.disabled = !ativo; pesPorQuadrado.disabled = !ativo; el("detectarGradeAgora").disabled = !ativo; el("diminuirGrade").disabled = !ativo; el("aumentarGrade").disabled = !ativo; el("salvarCampanhaAgora").disabled = !ativo; const mestre = ativo && papelExibido.textContent === "Mestre"; el("ativarNevoa").disabled = !mestre; el("raioNevoa").disabled = !mestre; el("modoNevoa").disabled = !mestre; el("limparRevelacao").disabled = !mestre; ["ferramentaCobrir","ferramentaRevelar","raioPincelNevoa","formatoPincelNevoa","limparNevoaManual","ferramentaParedes","limparParedes","aplicarVisaoToken","visaoTokenFt","ferramentaAreaEfeito","limparAreasEfeito"].forEach(id => { const c=el(id); if(c) c.disabled=!mestre; });
    ["atalhoMapa","atalhoToken","atalhoMontaria","atalhoSalvar"].forEach(id => { const b = el(id); if (b) b.disabled = !ativo; });
    const bloqueio = el("atalhoBloquearMapa"); if (bloqueio) { bloqueio.disabled = !mestre; bloqueio.classList.toggle("bloqueado", mapaBloqueado); bloqueio.setAttribute("aria-pressed", String(mapaBloqueado)); bloqueio.textContent = mapaBloqueado ? "🔒" : "🔓"; bloqueio.title = mapaBloqueado ? "Imagem do mapa bloqueada — clique para destravar" : "Bloquear a imagem do cenário carregado"; }
}
el("atalhoBloquearMapa").addEventListener("click", () => {
    if (papelExibido.textContent !== "Mestre" || !estaEmUmaSala()) return;
    socket.emit("alternar-bloqueio-mapa", !mapaBloqueado, resposta => { if (!resposta?.ok) mensagemSala.textContent = resposta?.mensagem || "Não foi possível alterar o bloqueio."; });
});
socket.on("bloqueio-mapa-atualizado", bloqueado => { mapaBloqueado = Boolean(bloqueado); atualizarPermissoes(); mensagemSala.textContent = mapaBloqueado ? "Imagem do mapa bloqueada: o cenário carregado não pode ser arrastado." : "Imagem do mapa desbloqueada."; });
function atualizarMapa() {
    cenario.style.transform = `translate(${posX}px, ${posY}px) scale(${zoom})`;
    const area = el("mapaVisualizacao");
    const tamanhoGrade = gradePx * zoom;
    area.style.backgroundSize = `${tamanhoGrade}px ${tamanhoGrade}px`;
    const origemX = area.clientWidth / 2 + (gradeX - 5000) * zoom + posX;
    const origemY = area.clientHeight / 2 + (gradeY - 4000) * zoom + posY;
    area.style.backgroundPosition = `${((origemX % tamanhoGrade) + tamanhoGrade) % tamanhoGrade}px ${((origemY % tamanhoGrade) + tamanhoGrade) % tamanhoGrade}px`;
    // A grade também é desenhada por cima do mapa, dentro do cenário transformado.
    cenario.style.setProperty("--grade-tamanho", `${gradePx}px`);
    cenario.style.setProperty("--grade-x", `${((gradeX % gradePx) + gradePx) % gradePx}px`);
    cenario.style.setProperty("--grade-y", `${((gradeY % gradePx) + gradePx) % gradePx}px`);
    el("informacaoGrade").textContent = `Grade atual: ${gradePx.toFixed(1)} px por quadrado. Escala: ${escalaGradeFt} ft por quadrado.`;
} 
function larguraTokenFt(pes) { return gradePx * (Number(pes || 5) / escalaGradeFt); }
function aplicarDimensoes(item, dados) {
    if (dados.tipo === "token") {
        const largura = larguraTokenFt(dados.tamanhoFt || 5);
        item.style.width = `${largura}px`; item.style.height = `${largura}px`;
        item.dataset.tamanhoFt = String(dados.tamanhoFt || 5);
    } else {
        const largura = Number(dados.largura) || (dados.tipo === "mapa" ? 900 : 600);
        item.style.width = `${largura}px`; item.style.height = "auto";
        item.dataset.largura = String(largura);
    }
}
function atualizarControlesItem() {
    const selecionado = Boolean(objetoSelecionado);
    nomeTokenSelecionado.disabled = !selecionado || objetoSelecionado.dataset.tipo !== "token";
    salvarNomeToken.disabled = !selecionado || objetoSelecionado.dataset.tipo !== "token";
    nomeTokenSelecionado.value = selecionado && objetoSelecionado.dataset.tipo === "token" ? (objetoSelecionado.dataset.nome || "Token") : "";
    diminuirTamanhoItem.disabled = !selecionado;
    aumentarTamanhoItem.disabled = !selecionado;
    aplicarTamanhoToken.disabled = !selecionado || objetoSelecionado.dataset.tipo !== "token";
    el("visaoTokenFt").disabled = !selecionado || objetoSelecionado.dataset.tipo !== "token" || papelExibido.textContent !== "Mestre";
    el("aplicarVisaoToken").disabled = !selecionado || objetoSelecionado.dataset.tipo !== "token" || papelExibido.textContent !== "Mestre";
    tamanhoTokenFt.disabled = !selecionado || objetoSelecionado.dataset.tipo !== "token";
    if (!selecionado) { itemSelecionadoInfo.textContent = "Selecione um token ou imagem no cenário."; return; }
    if (objetoSelecionado.dataset.tipo === "token") {
        const ft = Number(objetoSelecionado.dataset.tamanhoFt || 5);
        tamanhoTokenFt.value = String(ft); el("visaoTokenFt").value = String([30,60,90,120].includes(Number(objetoSelecionado.dataset.visaoFt)) ? Number(objetoSelecionado.dataset.visaoFt) : Number(nevoa.raioFt)||60);
        itemSelecionadoInfo.textContent = `Token selecionado — ${objetoSelecionado.dataset.nome || "Token"} — tamanho atual: ${ft} ft.`;
    } else {
        const largura = Math.round(Number(objetoSelecionado.dataset.largura) || objetoSelecionado.offsetWidth);
        itemSelecionadoInfo.textContent = `Imagem selecionada — largura aproximada: ${largura} px.`;
    }
}
function enviarRedimensionamento(item, dados) {
    if (!item || !estaEmUmaSala()) return;
    socket.emit("redimensionar-objeto", { id: item.id, largura: dados.largura, tamanhoFt: dados.tamanhoFt });
}
// Sessão atual da sala. Se o socket cair e reconectar, o servidor o enxerga como uma conexão NOVA,
// fora da sala; por isso guardamos nome/código/chave para reentrar automaticamente (ver reentrarNaSala).
let sessaoSala = null, tentativasReentrada = 0, temporizadorReentrada = null;
const campoChaveMestre = el("chaveMestre"), caixaChaveMestre = el("caixaChaveMestre"), chaveMestreExibida = el("chaveMestreExibida");
// A Chave do Mestre fica só neste navegador (localStorage); o servidor guarda apenas o hash dela.
const chaveLocal = codigo => "rpg-vtt:chave-mestre:" + codigo;
function lerChaveGuardada(codigo) { try { return localStorage.getItem(chaveLocal(codigo)) || ""; } catch (e) { return ""; } }
function guardarChave(codigo, chave) { try { localStorage.setItem(chaveLocal(codigo), chave); } catch (e) { /* modo privado: segue sem guardar */ } }
function esquecerChave(codigo) { try { localStorage.removeItem(chaveLocal(codigo)); } catch (e) { /* ignora */ } }
function mostrarChaveMestre(chave) { caixaChaveMestre.hidden = !chave; chaveMestreExibida.textContent = chave || ""; }
el("copiarChaveMestre").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(chaveMestreExibida.textContent); mensagemSala.textContent = "Chave do Mestre copiada."; }
    catch (e) { mensagemSala.textContent = "Não consegui copiar automaticamente. Selecione a chave e copie manualmente."; }
});
function mostrarSala(resposta, nome, chaveMestre) {
    if (!resposta || !resposta.ok) { mensagemSala.textContent = resposta?.mensagem || "Não foi possível entrar na sala."; return; }
    const ehMestre = resposta.papel === "Mestre" && Boolean(chaveMestre);
    sessaoSala = { nome, codigo: resposta.codigo, papel: resposta.papel, chaveMestre: ehMestre ? chaveMestre : "" };
    if (ehMestre) guardarChave(resposta.codigo, chaveMestre);
    mostrarChaveMestre(ehMestre ? chaveMestre : "");
    mensagemSala.textContent = resposta.mensagem || "Conectado à sala! As alterações são salvas automaticamente na nuvem."; painelSala.hidden = false;
    codigoExibido.textContent = resposta.codigo; papelExibido.textContent = resposta.papel; renderizarNevoa();
    campoCodigo.value = resposta.codigo; atualizarPermissoes();
}
el("salvarCampanhaAgora").addEventListener("click", () => socket.emit("salvar-campanha", {}, resposta => { mensagemSala.textContent = resposta?.ok ? "Campanha salva! Guarde o código da sala para continuar depois." : (resposta?.mensagem || "Não foi possível salvar a campanha."); }));
botaoCriarSala.addEventListener("click", () => { const nome = campoNome.value; socket.emit("criar-sala", { nome }, resposta => mostrarSala(resposta, nome, resposta?.chaveMestre)); });
botaoEntrarSala.addEventListener("click", () => {
    const nome = campoNome.value, codigo = campoCodigo.value.trim().toUpperCase();
    const digitada = campoChaveMestre.value.trim(), chaveMestre = digitada || lerChaveGuardada(codigo);   // neste navegador o Mestre volta sem digitar
    socket.emit("entrar-sala", { nome, codigo, chaveMestre }, resposta => {
        if (!resposta?.ok && chaveMestre && /Chave do Mestre/.test(resposta?.mensagem || "")) esquecerChave(codigo);
        mostrarSala(resposta, nome, chaveMestre); if (resposta?.ok) campoChaveMestre.value = "";
    });
});
socket.on("atualizar-sala", dados => {
    listaParticipantes.replaceChildren();
    dados.participantes.forEach(p => { const item = document.createElement("li"); item.textContent = `${p.nome} — ${p.papel}`; listaParticipantes.appendChild(item); });
});
socket.on("sala-encerrada", () => {
    sessaoSala = null; clearTimeout(temporizadorReentrada);
    mostrarChaveMestre(""); mensagemSala.textContent = "A sala foi encerrada."; painelSala.hidden = true;
    listaParticipantes.replaceChildren(); cenario.replaceChildren(); atualizarPermissoes();
});
// Reentrada automática: quando o socket reconecta (queda de rede, notebook/celular em repouso,
// servidor reiniciado) ele ganha um novo id e sai da sala no servidor. Sem isto, a tela continua
// mostrando a sala, mas a pessoa deixa de receber rolagens, tokens e tudo o mais.
function reentrarNaSala() {
    if (!sessaoSala) return;
    clearTimeout(temporizadorReentrada);
    const { nome, codigo, chaveMestre } = sessaoSala;
    socket.emit("entrar-sala", { nome, codigo, chaveMestre }, resposta => {
        if (resposta?.ok) {
            tentativasReentrada = 0; mostrarSala(resposta, nome, chaveMestre);
            mensagemSala.textContent = "Conexão restabelecida: você voltou para a sala."; return;
        }
        if (resposta?.temporario && tentativasReentrada++ < 8) {      // ex.: banco acordando; tenta de novo
            mensagemSala.textContent = "Reconectando à sala...";
            temporizadorReentrada = setTimeout(reentrarNaSala, 3000); return;
        }
        sessaoSala = null; tentativasReentrada = 0; painelSala.hidden = true; mostrarChaveMestre("");
        listaParticipantes.replaceChildren(); cenario.replaceChildren(); atualizarPermissoes();
        mensagemSala.textContent = resposta?.mensagem || "Não foi possível voltar para a sala. Entre novamente com o código.";
    });
}
socket.on("connect", () => { console.log("Conectado ao servidor! ID:", socket.id); if (sessaoSala) reentrarNaSala(); });
socket.on("disconnect", () => { if (sessaoSala) mensagemSala.textContent = "Conexão perdida. Tentando reconectar..."; });
socket.on("mestre-ausente", () => { mensagemSala.textContent = "O Mestre desconectou. A mesa continua aberta e ele pode voltar a qualquer momento."; });
socket.on("mestre-presente", () => { if (papelExibido.textContent !== "Mestre") mensagemSala.textContent = "O Mestre voltou à mesa."; });
socket.on("sessao-substituida", () => {
    sessaoSala = null; clearTimeout(temporizadorReentrada); mostrarChaveMestre("");
    mensagemSala.textContent = "Você entrou como Mestre em outro lugar. Esta aba saiu da sala."; painelSala.hidden = true;
    listaParticipantes.replaceChildren(); cenario.replaceChildren(); atualizarPermissoes();
});

function salvarVisualizacao() { if (estaEmUmaSala()) socket.emit("salvar-visualizacao", { zoom, posX, posY }); }
el("aumentarZoom").addEventListener("click", () => { zoom = Math.min(zoom + .2, 5); atualizarMapa(); salvarVisualizacao(); });
el("diminuirZoom").addEventListener("click", () => { zoom = Math.max(zoom - .2, .2); atualizarMapa(); salvarVisualizacao(); });
el("resetarZoom").addEventListener("click", () => { zoom = 1; posX = 0; posY = 0; atualizarMapa(); salvarVisualizacao(); });
function alternarPainelLateral() {
    const recolhido = document.body.classList.toggle("painel-recolhido");
    const botaoLateral = el("alternarPainelLateral");
    const simbolo = recolhido ? "›" : "‹";
    botaoLateral.textContent = simbolo;
    botaoLateral.setAttribute("aria-expanded", String(!recolhido));
    botaoLateral.setAttribute("aria-label", recolhido ? "Mostrar painel lateral" : "Esconder painel lateral");
    botaoLateral.title = recolhido ? "Mostrar painel lateral (tecla B)" : "Esconder painel lateral (tecla B)";
    el("alternarPainel").textContent = recolhido ? "☰ Mostrar ferramentas" : "☰ Ferramentas";
}
el("alternarPainel").addEventListener("click", alternarPainelLateral);
el("alternarPainelLateral").addEventListener("click", alternarPainelLateral);
document.addEventListener("keydown", evento => {
    const alvo = evento.target;
    const digitando = alvo && (alvo.matches("input, textarea, select") || alvo.isContentEditable);
    if (evento.code === "Space" && !digitando) {
        teclaEspacoPressionada = true;
        evento.preventDefault();
    }
    if (!digitando && !evento.ctrlKey && !evento.altKey && !evento.metaKey && evento.key.toLowerCase() === "b") {
        evento.preventDefault();
        alternarPainelLateral();
    }
    if (evento.key === "Escape" && document.body.classList.contains("modo-foco")) {
        document.body.classList.remove("modo-foco");
        el("sairModoFoco").hidden = true;
    }
});
document.addEventListener("keyup", evento => {
    if (evento.code === "Space") teclaEspacoPressionada = false;
});
window.addEventListener("blur", () => { teclaEspacoPressionada = false; });
el("modoFoco").addEventListener("click", () => { document.body.classList.add("modo-foco"); el("sairModoFoco").hidden = false; });
el("sairModoFoco").addEventListener("click", () => { document.body.classList.remove("modo-foco"); el("sairModoFoco").hidden = true; });

// Detecta uma periodicidade provável nas linhas da grade. Como mapas artísticos variam,
// os botões +Grade/-Grade permitem corrigir o resultado automaticamente estimado.
// Imagens externas são pedidas com CORS para que o navegador possa guardá-las em cache já "legíveis" pelo canvas
// (usado em "Detectar grade agora"). Data URLs de salas antigas não precisam disso.
function definirOrigemImagem(img, origem) { if (origem && !/^(data|blob):/.test(origem)) img.crossOrigin = "anonymous"; img.src = origem; }
function detectarGrade(dataUrl) {
    return new Promise(resolve => {
        const imagem = new Image();
        imagem.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                const maxDim = 700, fator = Math.min(1, maxDim / Math.max(imagem.naturalWidth, imagem.naturalHeight));
                canvas.width = Math.max(1, Math.round(imagem.naturalWidth * fator));
                canvas.height = Math.max(1, Math.round(imagem.naturalHeight * fator));
                const ctx = canvas.getContext("2d", { willReadFrequently: true });
                ctx.drawImage(imagem, 0, 0, canvas.width, canvas.height);
                const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                const colunas = new Array(canvas.width).fill(0), linhas = new Array(canvas.height).fill(0);
                for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
                    const i = (y * canvas.width + x) * 4;
                    const lum = (pixels[i] * .299 + pixels[i + 1] * .587 + pixels[i + 2] * .114) / 255;
                    const escuro = 1 - lum;
                    colunas[x] += escuro; linhas[y] += escuro;
                }
                const buscarPeriodo = perfil => {
                    const media = perfil.reduce((a,b)=>a+b,0) / perfil.length;
                    const centrado = perfil.map(v => v - media);
                    let melhor = { periodo: 0, score: -Infinity };
                    const maxPeriodo = Math.min(100, Math.floor(perfil.length / 3));
                    for (let p = 8; p <= maxPeriodo; p++) {
                        let soma = 0, base = 0, n = 0;
                        for (let i = 0; i < centrado.length - p; i++) { soma += centrado[i] * centrado[i+p]; base += centrado[i] * centrado[i]; n++; }
                        const score = base ? soma / base : -1;
                        if (n && score > melhor.score) melhor = { periodo: p, score };
                    }
                    if (melhor.score < .08) return null;
                    // A fase que concentra maior escuridão nos intervalos estimados.
                    let melhorFase = 0, maior = -Infinity;
                    for (let fase = 0; fase < melhor.periodo; fase++) {
                        let soma = 0, n = 0;
                        for (let i = fase; i < perfil.length; i += melhor.periodo) { soma += perfil[i]; n++; }
                        if (n && soma / n > maior) { maior = soma / n; melhorFase = fase; }
                    }
                    return { periodo: melhor.periodo / fator, fase: melhorFase / fator, confianca: melhor.score };
                };
                const x = buscarPeriodo(colunas), y = buscarPeriodo(linhas);
                if (!x && !y) return resolve(null);
                const periodo = x && y ? (x.periodo + y.periodo) / 2 : (x || y).periodo;
                resolve({ gradePx: Math.max(8, Math.min(180, periodo * 900 / imagem.naturalWidth)), faseX: x ? x.fase * 900 / imagem.naturalWidth : 0, faseY: y ? y.fase * 900 / imagem.naturalWidth : 0, origemLargura: imagem.naturalWidth });
            } catch (e) { resolve(null); }
        };
        imagem.onerror = () => resolve(null);
        if (!/^(data|blob):/.test(dataUrl)) imagem.crossOrigin = "anonymous";   // sem isto o canvas fica "contaminado" e a leitura falha
        imagem.src = dataUrl;
    });
}

async function enviarImagem(arquivo, tipo) {
    if (!estaEmUmaSala()) { mensagemSala.textContent = "Entre em uma sala primeiro."; return; }
    if (!arquivo) return;
    const permitidos = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    const limite = tipo === "mapa" ? 4 * 1024 * 1024 : 300 * 1024;
    if (!permitidos.includes(arquivo.type)) { mensagemSala.textContent = "Escolha PNG, JPG, WEBP ou GIF."; return; }
    if (arquivo.size > limite) { mensagemSala.textContent = tipo === "mapa" ? "A imagem deve ter no máximo 4 MB." : "O token deve ter no máximo 300 KB."; return; }
    const nomeArquivo = arquivo.name.replace(/\.[^.]+$/, "").slice(0, 40) || (tipo === "token" ? "Personagem" : "Mapa");
    const parametros = new URLSearchParams({ tipo, nome: nomeArquivo });
    if (tipo === "mapa") {
        mensagemSala.textContent = "Analisando a grade do mapa...";
        const leitura = await new Promise(resolver => { const leitor = new FileReader(); leitor.onload = () => resolver(leitor.result); leitor.onerror = () => resolver(null); leitor.readAsDataURL(arquivo); });
        if (!leitura) { mensagemSala.textContent = "Não foi possível ler o arquivo."; return; }
        const gradeDetectada = await detectarGrade(leitura);
        if (gradeDetectada) parametros.set("grade", JSON.stringify(gradeDetectada));
    }
    // O arquivo vai direto como corpo de uma requisição HTTP; o servidor o guarda no serviço de imagens
    // e avisa a sala inteira pelo WebSocket. O X-Socket-Id prova que quem envia está dentro da sala.
    mensagemSala.textContent = "Enviando imagem...";
    try {
        const resposta = await fetch("/api/imagens?" + parametros, { method: "POST", headers: { "Content-Type": arquivo.type, "X-Socket-Id": socket.id || "" }, body: arquivo });
        const dados = await resposta.json().catch(() => null);
        mensagemSala.textContent = dados?.mensagem || (resposta.ok ? "Imagem enviada." : "Não foi possível enviar a imagem.");
    } catch (erro) { mensagemSala.textContent = "Sem conexão com o servidor: a imagem não foi enviada."; }
}
botaoCarregarMapa.addEventListener("click", () => arquivoMapa.click());
botaoAdicionarToken.addEventListener("click", () => arquivoToken.click());
arquivoMapa.addEventListener("change", () => { const f = arquivoMapa.files[0]; arquivoMapa.value = ""; enviarImagem(f, "mapa"); });
arquivoToken.addEventListener("change", () => { const f = arquivoToken.files[0]; arquivoToken.value = ""; enviarImagem(f, "token"); });

// Os atalhos abrem um painel abaixo da barra, em vez de parecerem botões sem ação.
const painelAtalho = el("painelAtalho");
const tituloPainelAtalho = el("tituloPainelAtalho");
const acaoAtalhoPrincipal = el("acaoAtalhoPrincipal");
const acaoSalvarTokenBiblioteca = el("acaoSalvarTokenBiblioteca");
const acaoSalvarCampanha = el("acaoSalvarCampanha");
const ajudaPainelAtalho = el("ajudaPainelAtalho");
let tipoPainelAtalho = null;
function abrirPainelAtalho(tipo) {
    if (tipoPainelAtalho === tipo && !painelAtalho.hidden) { painelAtalho.hidden = true; tipoPainelAtalho = null; return; }
    tipoPainelAtalho = tipo; painelAtalho.hidden = false;
    acaoSalvarTokenBiblioteca.hidden = tipo !== "token";
    acaoSalvarCampanha.hidden = tipo !== "salvar";
    if (tipo === "mapa") {
        tituloPainelAtalho.textContent = "Mapas"; acaoAtalhoPrincipal.textContent = "Escolher imagem do mapa";
        ajudaPainelAtalho.textContent = "Selecione uma imagem no seu computador para compartilhar com a sala.";
    } else if (tipo === "token") {
        tituloPainelAtalho.textContent = "Tokens"; acaoAtalhoPrincipal.textContent = "Adicionar token do computador";
        ajudaPainelAtalho.textContent = "Tokens enviados são guardados automaticamente. Você também pode salvar um token já selecionado.";
    } else if (tipo === "montaria") {
        tituloPainelAtalho.textContent = "Montarias e criaturas"; acaoAtalhoPrincipal.textContent = "Adicionar imagem de montaria/criatura";
        ajudaPainelAtalho.textContent = "Escolha uma imagem PNG, JPG, WEBP ou GIF; ela será adicionada como token reutilizável.";
    } else if (tipo === "salvar") {
        tituloPainelAtalho.textContent = "Salvar"; acaoAtalhoPrincipal.textContent = "Salvar campanha agora";
        ajudaPainelAtalho.textContent = "Salva o estado atual da sala no servidor.";
    }
}
el("atalhoMapa").addEventListener("click", () => abrirPainelAtalho("mapa"));
el("atalhoToken").addEventListener("click", () => abrirPainelAtalho("token"));
el("atalhoMontaria").addEventListener("click", () => abrirPainelAtalho("montaria"));
el("atalhoSalvar").addEventListener("click", () => abrirPainelAtalho("salvar"));
el("atalhoMais").addEventListener("click", () => { painelAtalho.hidden = true; tipoPainelAtalho = null; el("menuFerramentasFoco").hidden = !el("menuFerramentasFoco").hidden; });
el("atalhoSelecionar").addEventListener("click", () => { atualizarModoFerramenta(null); painelAtalho.hidden = true; tipoPainelAtalho = null; });
acaoAtalhoPrincipal.addEventListener("click", () => {
    if (tipoPainelAtalho === "mapa") arquivoMapa.click();
    else if (tipoPainelAtalho === "token" || tipoPainelAtalho === "montaria") arquivoToken.click();
    else if (tipoPainelAtalho === "salvar") el("salvarCampanhaAgora").click();
    if (tipoPainelAtalho !== "salvar") { painelAtalho.hidden = true; tipoPainelAtalho = null; }
});
acaoSalvarCampanha.addEventListener("click", () => { el("salvarCampanhaAgora").click(); painelAtalho.hidden = true; tipoPainelAtalho = null; });
acaoSalvarTokenBiblioteca.addEventListener("click", () => {
    if (!objetoSelecionado || objetoSelecionado.dataset.tipo !== "token") { mensagemSala.textContent = "Selecione primeiro um token no cenário."; return; }
    if (!estaEmUmaSala()) { mensagemSala.textContent = "Entre em uma sala primeiro."; return; }
    socket.emit("salvar-token-biblioteca", { id: objetoSelecionado.id }, resposta => {
        mensagemSala.textContent = resposta?.mensagem || (resposta?.ok ? "Token salvo na biblioteca." : "Não foi possível salvar o token.");
        if (resposta?.ok) { painelAtalho.hidden = true; tipoPainelAtalho = null; }
    });
});
document.addEventListener("click", evento => {
    if (!evento.target.closest(".barra-atalhos-mapa") && !evento.target.closest(".painel-atalho")) { painelAtalho.hidden = true; tipoPainelAtalho = null; }
});

function criarElemento(dados) {
    let item;
    if (dados.tipo === "token") {
        item = document.createElement("div"); item.className = "objeto-cenario objeto-token-wrapper";
        const imagem = document.createElement("img"); definirOrigemImagem(imagem, dados.url || dados.dataUrl || ""); imagem.alt = dados.nome || "Token"; imagem.draggable = false;
        const rotulo = document.createElement("span"); rotulo.className = "rotulo-token"; rotulo.textContent = dados.nome || "Token";
        const alca = document.createElement("span"); alca.className = "alca-redimensionar-token"; alca.title = "Arraste para aumentar ou diminuir o token"; alca.setAttribute("aria-label", "Redimensionar token");
        alca.addEventListener("mousedown", iniciarRedimensionamentoToken);
        const girador = document.createElement("span"); girador.className = "alca-rotacao-token"; girador.title = "Arraste para girar o token"; girador.setAttribute("aria-label", "Girar token"); girador.textContent = "↻";
        girador.addEventListener("mousedown", iniciarRotacaoToken);
        item.append(imagem, rotulo, alca, girador);
    } else {
        item = document.createElement("img"); definirOrigemImagem(item, dados.url || dados.dataUrl || ""); item.alt = dados.nome || (dados.tipo === "mapa" ? "Mapa" : "Imagem da mesa");
        item.className = "objeto-cenario " + (dados.tipo === "mapa" ? "objeto-mapa" : "objeto-imagem"); item.draggable = false;
    }
    item.id = dados.id; item.dataset.tipo = dados.tipo; item.dataset.nome = dados.nome || (dados.tipo === "token" ? "Token" : "");
    if (dados.bibliotecaId) item.dataset.bibliotecaId = dados.bibliotecaId; if (dados.oculto) item.dataset.oculto = "true";
    item.dataset.rotacao = String(Number.isFinite(Number(dados.rotacao)) ? Number(dados.rotacao) : 0);
    if (dados.tipo === "token") item.style.transform = `rotate(${item.dataset.rotacao}deg)`;
    aplicarDimensoes(item, dados);
    item.tabIndex = 0; item.title = "Clique para selecionar; DEL para apagar; botão direito para opções";
    item.style.left = `${dados.left}px`; item.style.top = `${dados.top}px`;
    item.addEventListener("mousedown", iniciarArrastoObjeto);
    item.addEventListener("click", () => selecionarObjeto(item));
    item.addEventListener("dblclick", () => { if (dados.tipo === "token") { selecionarObjeto(item); const novoNome=prompt("Nome que aparecerá embaixo do token:", item.dataset.nome || "Token"); if(novoNome && novoNome.trim()) socket.emit("renomear-objeto", {id:item.id,nome:novoNome.trim().slice(0,40)}, resposta=>{if(!resposta?.ok) mensagemSala.textContent=resposta?.mensagem||"Não foi possível renomear o token.";}); } });
    item.addEventListener("contextmenu", evento => {
        evento.preventDefault(); selecionarObjeto(item);
        alternarVisibilidadeToken.hidden = item.dataset.tipo !== "token" || papelExibido.textContent !== "Mestre";
        alternarVisibilidadeToken.textContent = item.dataset.oculto === "true" ? "Revelar token para jogadores" : "Ocultar token para jogadores";
        menuObjeto.style.left = `${Math.min(evento.clientX, window.innerWidth - 200)}px`;
        menuObjeto.style.top = `${Math.min(evento.clientY, window.innerHeight - 55)}px`;
        menuObjeto.hidden = false;
    });
    return item;
}
function renderizarBibliotecaTokens() {
    if (!listaPersonagensSalvos) return;
    listaPersonagensSalvos.replaceChildren();
    if (!bibliotecaTokens.length) { const vazio = document.createElement("p"); vazio.className = "ajuda"; vazio.textContent = "Nenhum personagem salvo ainda. Adicione um token para guardá-lo aqui."; listaPersonagensSalvos.appendChild(vazio); return; }
    bibliotecaTokens.forEach(token => {
        const botao = document.createElement("button"); botao.type = "button"; botao.className = "cartao-personagem"; botao.title = `Adicionar ${token.nome} ao cenário`;
        const img = document.createElement("img"); definirOrigemImagem(img, token.url || token.dataUrl || ""); img.alt = token.nome;
        const nome = document.createElement("span"); nome.textContent = token.nome;
        botao.append(img, nome); botao.addEventListener("click", () => socket.emit("recolocar-token", { bibliotecaId: token.id }, resposta => { if (resposta && !resposta.ok) mensagemSala.textContent = resposta.mensagem; }));
        const remover = document.createElement("button"); remover.type="button"; remover.className="remover-token-salvo"; remover.textContent="×"; remover.title=`Excluir ${token.nome} da biblioteca`;
        remover.addEventListener("click", evento => { evento.stopPropagation(); if(confirm(`Excluir “${token.nome}” da biblioteca? Tokens já colocados no mapa serão mantidos.`)) socket.emit("apagar-token-biblioteca", {id:token.id}, resposta => { mensagemSala.textContent=resposta?.mensagem || (resposta?.ok ? "Token removido." : "Não foi possível remover o token."); }); });
        const cartao = document.createElement("div"); cartao.className="cartao-personagem-container"; cartao.append(botao, remover); listaPersonagensSalvos.appendChild(cartao);
    });
}

function iniciarRotacaoToken(evento) {
    if (evento.button !== 0 || !objetoSelecionado || objetoSelecionado.dataset.tipo !== "token" || !estaEmUmaSala()) return;
    evento.preventDefault(); evento.stopPropagation();
    const item = evento.currentTarget.closest(".objeto-token-wrapper");
    selecionarObjeto(item);
    tokenRotacionando = item;
    const rect = item.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    anguloInicialRotacao = Math.atan2(evento.clientY - cy, evento.clientX - cx) * 180 / Math.PI - Number(item.dataset.rotacao || 0);
}
function aplicarRotacaoToken(item, graus, enviar=true) {
    if (!item || item.dataset.tipo !== "token") return;
    const rotacao = ((Math.round(graus / 15) * 15) % 360 + 360) % 360;
    item.dataset.rotacao = String(rotacao); item.style.transform = `rotate(${rotacao}deg)`;
    if (enviar && estaEmUmaSala()) socket.emit("rotacionar-objeto", {id:item.id, rotacao});
}
function selecionarObjeto(item) {
    if (objetoSelecionado && objetoSelecionado !== item) objetoSelecionado.classList.remove("selecionado");
    objetoSelecionado = item;
    if (objetoSelecionado) objetoSelecionado.classList.add("selecionado");
    atualizarControlesItem();
}
function fecharMenuObjeto() { menuObjeto.hidden = true; }
const SVG_NS = "http://www.w3.org/2000/svg";
function criarCamadaDesenho() {
    const svg = document.createElementNS(SVG_NS, "svg"); svg.id = "camadaDesenho";
    svg.setAttribute("viewBox", "0 0 10000 8000"); svg.setAttribute("width", "10000"); svg.setAttribute("height", "8000");
    svg.style.cssText = "position:absolute;left:0;top:0;width:10000px;height:8000px;overflow:visible;pointer-events:none;z-index:4;";
    return svg;
}
function criarCamadaNevoa() {
    const svg = document.createElementNS(SVG_NS, "svg"); svg.id = "camadaNevoa";
    svg.setAttribute("viewBox", "0 0 10000 8000"); svg.setAttribute("width", "10000"); svg.setAttribute("height", "8000");
    svg.style.cssText = "position:absolute;left:0;top:0;width:10000px;height:8000px;overflow:visible;pointer-events:none;z-index:10;";
    return svg;
}
function intersecaoRaioParede(ox, oy, dx, dy, parede) {
    const sx = parede.x2 - parede.x1, sy = parede.y2 - parede.y1;
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 0.00001) return null;
    const qx = parede.x1 - ox, qy = parede.y1 - oy;
    const t = (qx * sy - qy * sx) / denom;
    const u = (qx * dy - qy * dx) / denom;
    if (t >= 0 && u >= 0 && u <= 1) return t;
    return null;
}
function poligonoVisao(cx, cy, raio, paredes) {
    const angulos = [];
    for (let i = 0; i < 180; i++) angulos.push((i / 180) * Math.PI * 2);
    // Raios extras em volta dos extremos das paredes reduzem falhas visuais nas quinas.
    paredes.forEach(w => {
        for (const p of [{x:w.x1,y:w.y1},{x:w.x2,y:w.y2}]) {
            const a = Math.atan2(p.y-cy,p.x-cx);
            angulos.push(a-0.0008,a,a+0.0008);
        }
    });
    return angulos.map(a => {
        const dx=Math.cos(a), dy=Math.sin(a); let distancia=raio;
        paredes.forEach(w => { const t=intersecaoRaioParede(cx,cy,dx,dy,w); if(t!==null && t<distancia) distancia=t; });
        return `${(cx+dx*distancia).toFixed(2)},${(cy+dy*distancia).toFixed(2)}`;
    }).join(" ");
}
function renderizarNevoa() {
    const svg = el("camadaNevoa"); if (!svg) return;
    svg.replaceChildren();
    const ehMestre = papelExibido.textContent === "Mestre";
    const paredes = Array.isArray(nevoa.paredes) ? nevoa.paredes : [];
    const paredesBloqueantes = paredes.filter(w => !w.aberta);
    if (ehMestre) {
        // Paredes ficam visíveis apenas ao Mestre, como linhas auxiliares para preparar a visão.
        paredes.forEach((w,indiceParede) => { const l=document.createElementNS(SVG_NS,"line"); l.style.pointerEvents="stroke"; l.style.cursor="pointer"; l.setAttribute("x1",w.x1); l.setAttribute("y1",w.y1); l.setAttribute("x2",w.x2); l.setAttribute("y2",w.y2); l.setAttribute("stroke",w.aberta?"#4ade80":"#38bdf8"); l.setAttribute("stroke-width","7"); l.setAttribute("stroke-opacity","0.9"); l.setAttribute("stroke-dasharray",w.aberta?"10 8":"none"); l.setAttribute("stroke-linecap","round"); l.setAttribute("title",w.aberta?"Clique para fechar a porta/passagem":"Clique para abrir a porta/passagem"); l.addEventListener("click",evento=>{ evento.preventDefault(); evento.stopPropagation(); const novas=paredes.map((parede,i)=>i===indiceParede?{...parede,aberta:!parede.aberta}:parede); socket.emit("salvar-paredes-nevoa",{paredes:novas},r=>{ if(!r?.ok) mensagemSala.textContent=r?.mensagem||"Não foi possível alterar a passagem."; else mensagemSala.textContent=novas[indiceParede].aberta?"Passagem aberta: a visão atravessa." : "Passagem fechada: a visão está bloqueada."; }); }); svg.appendChild(l); });
        if (modoDesenharParedes && inicioParedeAtual && fimParedeAtual) { const l=document.createElementNS(SVG_NS,"line"); l.setAttribute("x1",inicioParedeAtual.x); l.setAttribute("y1",inicioParedeAtual.y); l.setAttribute("x2",fimParedeAtual.x); l.setAttribute("y2",fimParedeAtual.y); l.setAttribute("stroke","#7dd3fc"); l.setAttribute("stroke-width","8"); l.setAttribute("stroke-dasharray","12 8"); l.setAttribute("stroke-linecap","round"); svg.appendChild(l); }
        const desenharPrevia = (m, opacidade) => {
            if (!m || m.tipo !== "cobrir") return;
            const forma = m.forma === "quadrado" ? document.createElementNS(SVG_NS,"rect") : document.createElementNS(SVG_NS,"circle");
            if (m.forma === "quadrado") { forma.setAttribute("x",String(m.x-m.raio)); forma.setAttribute("y",String(m.y-m.raio)); forma.setAttribute("width",String(m.raio*2)); forma.setAttribute("height",String(m.raio*2)); }
            else { forma.setAttribute("cx",String(m.x)); forma.setAttribute("cy",String(m.y)); forma.setAttribute("r",String(m.raio)); }
            forma.setAttribute("fill","#000000"); forma.setAttribute("fill-opacity",String(opacidade));
            forma.setAttribute("stroke","#000000"); forma.setAttribute("stroke-opacity","0.12"); forma.setAttribute("stroke-width","2"); svg.appendChild(forma);
        };
        (nevoa.marcasManuais || []).forEach(m => desenharPrevia(m,0.16));
        if (desenhandoNevoa) (marcasNevoaAtual || []).forEach(m => desenharPrevia(m,0.24));
        return;
    }
    if (!nevoa.ativada) return;
    const defs=document.createElementNS(SVG_NS,"defs"); const mask=document.createElementNS(SVG_NS,"mask"); mask.id="mascaraNevoa"; mask.setAttribute("maskUnits","userSpaceOnUse");
    const fundo=document.createElementNS(SVG_NS,"rect"); fundo.setAttribute("x","0"); fundo.setAttribute("y","0"); fundo.setAttribute("width","10000"); fundo.setAttribute("height","8000"); fundo.setAttribute("fill","white"); mask.appendChild(fundo);
    if (nevoa.modoExploracao === "dinamica") {
        document.querySelectorAll(".objeto-cenario[data-tipo='token']").forEach(t => {
            const tamanho=Number(t.dataset.tamanhoFt)||5; const cx=(parseFloat(t.style.left)||0)+larguraTokenFt(tamanho)/2; const cy=(parseFloat(t.style.top)||0)+larguraTokenFt(tamanho)/2;
            const raio=Math.max(1,Number(t.dataset.visaoFt)||Number(nevoa.raioFt)||60)/escalaGradeFt*gradePx;
            const poly=document.createElementNS(SVG_NS,"polygon"); poly.setAttribute("points",poligonoVisao(cx,cy,raio,paredesBloqueantes)); poly.setAttribute("fill","black"); mask.appendChild(poly);
        });
    } else {
        (nevoa.revelacoes||[]).forEach(r=>{ const c=document.createElementNS(SVG_NS,"circle"); c.setAttribute("cx",String(r.x)); c.setAttribute("cy",String(r.y)); c.setAttribute("r",String(Math.max(1,Number(r.raioFt)/escalaGradeFt*gradePx))); c.setAttribute("fill","black"); mask.appendChild(c); });
    }
    (nevoa.marcasManuais||[]).forEach(m=>{
        const forma=m.forma==="quadrado"?document.createElementNS(SVG_NS,"rect"):document.createElementNS(SVG_NS,"circle");
        if(m.forma==="quadrado"){forma.setAttribute("x",String(m.x-m.raio));forma.setAttribute("y",String(m.y-m.raio));forma.setAttribute("width",String(m.raio*2));forma.setAttribute("height",String(m.raio*2));}
        else{forma.setAttribute("cx",String(m.x));forma.setAttribute("cy",String(m.y));forma.setAttribute("r",String(m.raio));}
        forma.setAttribute("fill",m.tipo==="revelar"?"black":"white");mask.appendChild(forma);
    });
    defs.appendChild(mask); svg.appendChild(defs);
    const esc=document.createElementNS(SVG_NS,"rect"); esc.setAttribute("x","0"); esc.setAttribute("y","0"); esc.setAttribute("width","10000"); esc.setAttribute("height","8000"); esc.setAttribute("fill","#05060c"); esc.setAttribute("fill-opacity","1"); esc.setAttribute("mask","url(#mascaraNevoa)"); svg.appendChild(esc);
}

function apagarDesenho(id) {
    if (!id || !estaEmUmaSala()) return;
    socket.emit("apagar-desenho", { id }, resposta => {
        if (!resposta?.ok) mensagemSala.textContent = resposta?.mensagem || "Não foi possível apagar esse traço.";
        else if (desenhoSelecionadoId === id) desenhoSelecionadoId = null;
    });
}
function desenharPolilinha(svg, pontos, cor="#ffdf70", largura=3, desenho=null) {
    if (!pontos || pontos.length < 2) return;
    const linha = document.createElementNS(SVG_NS, "polyline");
    linha.setAttribute("points", pontos.map(p => `${p.x},${p.y}`).join(" ")); linha.setAttribute("fill", "none");
    linha.setAttribute("stroke", cor); linha.setAttribute("stroke-width", String(largura)); linha.setAttribute("stroke-linecap", "round"); linha.setAttribute("stroke-linejoin", "round");
    if (desenho) {
        linha.classList.add("desenho-risco"); linha.dataset.desenhoId = desenho.id; linha.style.pointerEvents = "stroke"; linha.style.cursor = "pointer";
        if (desenho.id === desenhoSelecionadoId) { linha.setAttribute("stroke-width", String(largura + 3)); linha.style.filter = "drop-shadow(0 0 4px #ff4d6d)"; }
        linha.addEventListener("click", evento => { evento.preventDefault(); evento.stopPropagation(); desenhoSelecionadoId = desenho.id; renderizarDesenhos(); });
        linha.addEventListener("contextmenu", evento => { evento.preventDefault(); evento.stopPropagation(); apagarDesenho(desenho.id); });
    }
    svg.appendChild(linha);
}
function renderizarDesenhos() {
    const svg = el("camadaDesenho"); if (!svg) return; svg.replaceChildren();
    areasEfeito.forEach(a => {
        const px = Math.max(1, Number(a.tamanhoFt)||20) / escalaGradeFt * gradePx;
        let forma;
        if (a.tipo === "circulo") { forma=document.createElementNS(SVG_NS,"circle"); forma.setAttribute("cx",a.x); forma.setAttribute("cy",a.y); forma.setAttribute("r",px); }
        else if (a.tipo === "quadrado") { forma=document.createElementNS(SVG_NS,"rect"); forma.setAttribute("x",a.x-px/2); forma.setAttribute("y",a.y-px/2); forma.setAttribute("width",px); forma.setAttribute("height",px); }
        else if (a.tipo === "linha") { const larg=Math.max(4, 5/escalaGradeFt*gradePx); forma=document.createElementNS(SVG_NS,"rect"); forma.setAttribute("x",a.x-px/2); forma.setAttribute("y",a.y-larg/2); forma.setAttribute("width",px); forma.setAttribute("height",larg); }
        else { forma=document.createElementNS(SVG_NS,"polygon"); forma.setAttribute("points",`${a.x},${a.y} ${a.x-px/2},${a.y-px} ${a.x+px/2},${a.y-px}`); }
        if (a.tipo === "cone" || a.tipo === "linha") forma.setAttribute("transform",`rotate(${Number(a.angulo)||0} ${a.x} ${a.y})`);
        forma.classList.add("area-efeito"); forma.dataset.areaId=a.id; forma.style.pointerEvents="auto"; forma.style.cursor="pointer";
        forma.setAttribute("fill","#fb923c"); forma.setAttribute("fill-opacity","0.22"); forma.setAttribute("stroke",areaEfeitoSelecionadaId===a.id?"#facc15":"#fb923c"); forma.setAttribute("stroke-width",areaEfeitoSelecionadaId===a.id?"7":"3");
        forma.addEventListener("click",ev=>{ ev.preventDefault(); ev.stopPropagation(); if(papelExibido.textContent==="Mestre"){if(objetoSelecionado){objetoSelecionado.classList.remove("selecionado");objetoSelecionado=null;atualizarControlesItem();}desenhoSelecionadoId=null;areaEfeitoSelecionadaId=a.id;renderizarDesenhos();mensagemSala.textContent="Área selecionada. Q/E gira, Delete remove.";} });
        svg.appendChild(forma);
    });
    desenhos.forEach(d => desenharPolilinha(svg, d.pontos, d.cor, d.largura, d));
    if (pontosDesenhoAtual.length > 1) desenharPolilinha(svg, pontosDesenhoAtual);
    if (pontoReguaInicio && pontoReguaFim) { desenharPolilinha(svg, [pontoReguaInicio, pontoReguaFim], "#7dd3fc", 2); const distancia = Math.hypot(pontoReguaFim.x-pontoReguaInicio.x, pontoReguaFim.y-pontoReguaInicio.y); const pes = distancia / gradePx * escalaGradeFt; const texto = document.createElementNS(SVG_NS, "text"); texto.setAttribute("x", String((pontoReguaInicio.x+pontoReguaFim.x)/2)); texto.setAttribute("y", String((pontoReguaInicio.y+pontoReguaFim.y)/2-10)); texto.setAttribute("fill", "#7dd3fc"); texto.setAttribute("stroke", "#111"); texto.setAttribute("stroke-width", "0.8"); texto.setAttribute("paint-order", "stroke"); texto.setAttribute("font-size", "28"); texto.setAttribute("font-weight", "bold"); texto.textContent = `${pes.toFixed(1)} ft`; svg.appendChild(texto); }
}
let pontoReguaFim = null;
function coordenadaCenario(evento) { const rect = areaVisualizacao.getBoundingClientRect(); return { x: Math.max(0, Math.min(10000, 5000 + (evento.clientX - rect.left - rect.width/2 - posX)/zoom)), y: Math.max(0, Math.min(8000, 4000 + (evento.clientY - rect.top - rect.height/2 - posY)/zoom)) }; }
function registrarMarcaNevoa(evento) {
    const p=coordenadaCenario(evento);
    const raio=Number(el("raioPincelNevoa").value)||90;
    const forma=el("formatoPincelNevoa")?.value==="quadrado"?"quadrado":"circulo";
    const ultima=marcasNevoaAtual[marcasNevoaAtual.length-1];
    if (!ultima) {
        marcasNevoaAtual.push({x:p.x,y:p.y,raio,tipo:modoPincelNevoa,forma});
    } else {
        // Interpola pontos entre eventos do mouse para evitar falhas em traços rápidos.
        const distancia=Math.hypot(p.x-ultima.x,p.y-ultima.y);
        const passo=Math.max(4,raio*0.22);
        const quantidade=Math.min(120,Math.floor(distancia/passo));
        for(let i=1;i<=quantidade;i++){
            const t=i/(quantidade+1);
            marcasNevoaAtual.push({x:ultima.x+(p.x-ultima.x)*t,y:ultima.y+(p.y-ultima.y)*t,raio,tipo:modoPincelNevoa,forma});
        }
        if(distancia>0.5) marcasNevoaAtual.push({x:p.x,y:p.y,raio,tipo:modoPincelNevoa,forma});
    }
    if(marcasNevoaAtual.length>1400) marcasNevoaAtual=marcasNevoaAtual.slice(-1400);
    renderizarNevoa();
}

function atualizarModoFerramenta(modo) {
    modoFerramenta = modo;
    el("ativarMoverCenario").classList.toggle("ativo", modo === "mover");
    el("ativarRegua").classList.toggle("ativo", modo === "regua");
    el("ativarDesenho").classList.toggle("ativo", modo === "desenho");
    el("estadoFerramenta").textContent = modo === "mover" ? "Modo mover cenário ativo: arraste em qualquer lugar, inclusive sobre tokens e imagens, para mover a visão." : modo === "regua" ? "Arraste no cenário para medir em pés." : modo === "desenho" ? "Arraste no cenário para desenhar." : "Selecione uma ferramenta.";
    areaVisualizacao.style.cursor = modo === "desenho" || modo === "regua" ? "crosshair" : modo === "mover" ? "grab" : "default";
}

// Desativa todas as ferramentas de uma vez (modos e destaque visual), para que
// escolher uma ferramenta nova sempre substitua a anterior sem precisar desmarcar antes.
function desativarTodasFerramentas() {
    modoFerramenta = null;
    modoDesenharParedes = false;
    modoPincelNevoa = null;
    modoAreaEfeito = false;
    ["ativarMoverCenario","ativarRegua","ativarDesenho","ferramentaParedes","ferramentaCobrir","ferramentaRevelar","ferramentaAreaEfeito"].forEach(id => el(id).classList.remove("ativo"));
    el("estadoFerramenta").textContent = "Selecione uma ferramenta.";
    areaVisualizacao.style.cursor = "default";
}
el("ferramentaAreaEfeito").addEventListener("click",()=>{ if(papelExibido.textContent!=="Mestre"||!estaEmUmaSala())return; const ativar=!modoAreaEfeito; desativarTodasFerramentas(); if(ativar){ modoAreaEfeito=true; el("ferramentaAreaEfeito").classList.add("ativo"); } mensagemSala.textContent=modoAreaEfeito?"Clique no mapa para posicionar a área de efeito.":"Posicionamento de áreas de efeito desativado."; });
el("limparAreasEfeito").addEventListener("click",()=>{ if(papelExibido.textContent==="Mestre"&&confirm("Remover todas as áreas de efeito desta campanha?")) socket.emit("salvar-areas-efeito",{areas:[]}); });
function salvarAreasEfeito(){ socket.emit("salvar-areas-efeito",{areas:areasEfeito},r=>{if(!r?.ok)mensagemSala.textContent=r?.mensagem||"Não foi possível salvar as áreas de efeito.";}); }
socket.on("areas-efeito-atualizadas",lista=>{areasEfeito=Array.isArray(lista)?lista:[];if(!areasEfeito.some(a=>a.id===areaEfeitoSelecionadaId))areaEfeitoSelecionadaId=null;renderizarDesenhos();});
el("abrirMenuFerramentas").addEventListener("click", () => { el("menuFerramentasFoco").hidden = !el("menuFerramentasFoco").hidden; });
el("ativarMoverCenario").addEventListener("click", () => { const ativar = modoFerramenta !== "mover"; desativarTodasFerramentas(); if (ativar) atualizarModoFerramenta("mover"); });
el("ativarRegua").addEventListener("click", () => { const ativar = modoFerramenta !== "regua"; desativarTodasFerramentas(); if (ativar) atualizarModoFerramenta("regua"); });
el("ativarDesenho").addEventListener("click", () => { const ativar = modoFerramenta !== "desenho"; desativarTodasFerramentas(); if (ativar) atualizarModoFerramenta("desenho"); });
el("limparDesenhos").addEventListener("click", () => { if (estaEmUmaSala()) socket.emit("limpar-desenhos", {}, resposta => { if (!resposta?.ok) mensagemSala.textContent = resposta?.mensagem || "Não foi possível limpar os desenhos."; }); });
el("ativarNevoa").addEventListener("change", () => {
    if (papelExibido.textContent !== "Mestre") return;
    socket.emit("configurar-nevoa", { ativada: el("ativarNevoa").checked, raioFt: Number(el("raioNevoa").value), modoExploracao: el("modoNevoa").value }, resposta => { if (!resposta?.ok) mensagemSala.textContent = resposta?.mensagem || "Não foi possível configurar a escuridão."; });
});
el("raioNevoa").addEventListener("change", () => {
    if (papelExibido.textContent !== "Mestre") return;
    socket.emit("configurar-nevoa", { ativada: el("ativarNevoa").checked, raioFt: Number(el("raioNevoa").value), modoExploracao: el("modoNevoa").value }, resposta => { if (!resposta?.ok) mensagemSala.textContent = resposta?.mensagem || "Não foi possível alterar o alcance."; });
});
el("limparRevelacao").addEventListener("click", () => { if (papelExibido.textContent === "Mestre") socket.emit("limpar-revelacao-nevoa", {}, resposta => { if (!resposta?.ok) mensagemSala.textContent = resposta?.mensagem || "Não foi possível reiniciar a escuridão."; }); });
el("modoNevoa").addEventListener("change", () => { if (papelExibido.textContent === "Mestre") socket.emit("configurar-nevoa", {ativada:el("ativarNevoa").checked,raioFt:Number(el("raioNevoa").value),modoExploracao:el("modoNevoa").value}); });
el("ferramentaParedes").addEventListener("click", () => { const ativar=!modoDesenharParedes; desativarTodasFerramentas(); if(ativar){ modoDesenharParedes=true; el("ferramentaParedes").classList.add("ativo"); } mensagemSala.textContent=modoDesenharParedes ? "Arraste de uma ponta à outra de cada parede ou porta fechada. Linhas azuis são visíveis apenas para o Mestre." : "Ferramenta de paredes desativada."; });
el("limparParedes").addEventListener("click", () => { if(papelExibido.textContent!=="Mestre" || !confirm("Apagar todas as paredes de visão desta campanha?")) return; socket.emit("salvar-paredes-nevoa",{paredes:[]},r=>{ if(!r?.ok) mensagemSala.textContent=r?.mensagem||"Não foi possível limpar as paredes."; }); });
el("aplicarVisaoToken").addEventListener("click", () => { if(!objetoSelecionado || objetoSelecionado.dataset.tipo!=="token" || papelExibido.textContent!=="Mestre") return; socket.emit("definir-visao-token",{id:objetoSelecionado.id,visaoFt:Number(el("visaoTokenFt").value)},r=>{ if(!r?.ok) mensagemSala.textContent=r?.mensagem||"Não foi possível alterar o alcance de visão."; else mensagemSala.textContent="Alcance de visão atualizado para este token."; }); });

el("ferramentaCobrir").addEventListener("click", () => { const ativar = modoPincelNevoa !== "cobrir"; desativarTodasFerramentas(); if (ativar) { modoPincelNevoa = "cobrir"; el("ferramentaCobrir").classList.add("ativo"); } mensagemSala.textContent = modoPincelNevoa ? "Arraste no mapa para cobrir áreas para os jogadores." : "Pincel de nevoa desativado."; });
el("ferramentaRevelar").addEventListener("click", () => { const ativar = modoPincelNevoa !== "revelar"; desativarTodasFerramentas(); if (ativar) { modoPincelNevoa = "revelar"; el("ferramentaRevelar").classList.add("ativo"); } mensagemSala.textContent = modoPincelNevoa ? "Arraste no mapa para revelar áreas aos jogadores." : "Pincel de nevoa desativado."; });
el("limparNevoaManual").addEventListener("click", () => { if(confirm("Limpar todas as marcas manuais de nevoa?")) socket.emit("limpar-nevoa-manual",{},r=>{if(!r?.ok) mensagemSala.textContent=r?.mensagem||"Não foi possível limpar as marcas.";}); });
el("raioPincelNevoa").addEventListener("input",()=>{ const saida=el("valorRaioPincelNevoa"); if(saida) saida.textContent=`${el("raioPincelNevoa").value} px`; });
el("formatoPincelNevoa").addEventListener("change",()=>{ mensagemSala.textContent=`Pincel ${el("formatoPincelNevoa").value==="quadrado"?"quadrado":"circular"} selecionado.`; });

socket.on("desenhos-atualizados", lista => { desenhos = Array.isArray(lista) ? lista : []; if (!desenhos.some(d => d.id === desenhoSelecionadoId)) desenhoSelecionadoId = null; renderizarDesenhos(); });
socket.on("nevoa-atualizada", dados => { if (!dados) return; nevoa = { ativada: Boolean(dados.ativada), raioFt: [30,60,90,120].includes(Number(dados.raioFt)) ? Number(dados.raioFt) : 60, modoExploracao: dados.modoExploracao === "dinamica" ? "dinamica" : "persistente", revelacoes: Array.isArray(dados.revelacoes) ? dados.revelacoes : [], marcasManuais: Array.isArray(dados.marcasManuais) ? dados.marcasManuais.map(m=>({...m,forma:m.forma==="quadrado"?"quadrado":"circulo"})) : [], paredes: Array.isArray(dados.paredes) ? dados.paredes : [] }; el("ativarNevoa").checked = nevoa.ativada; el("raioNevoa").value = String(nevoa.raioFt); el("modoNevoa").value = nevoa.modoExploracao; renderizarNevoa(); });

function renderizarObjetos(objetos) {
    objetoSelecionado = null;
    atualizarControlesItem();
    fecharMenuObjeto();
    const svg = criarCamadaDesenho();
    const camadaEscuridao = criarCamadaNevoa();
    cenario.replaceChildren(svg, camadaEscuridao);
    objetos.forEach(obj => { const elemento = criarElemento(obj); if (obj.tipo === "token") elemento.dataset.visaoFt = String([30,60,90,120].includes(Number(obj.visaoFt)) ? Number(obj.visaoFt) : Number(nevoa.raioFt)||60); elemento.style.zIndex = obj.tipo === "token" ? "8" : "1"; cenario.appendChild(elemento); });
    renderizarDesenhos(); renderizarNevoa();
}
socket.on("estado-cenario", estado => {
    if (Number.isFinite(Number(estado.gradePx))) gradePx = Math.max(8, Math.min(180, Number(estado.gradePx)));
    if (Number.isFinite(Number(estado.gradeX))) gradeX = Number(estado.gradeX);
    if (Number.isFinite(Number(estado.gradeY))) gradeY = Number(estado.gradeY);
    if (estado.view) { zoom = Number(estado.view.zoom) || 1; posX = Number(estado.view.posX) || 0; posY = Number(estado.view.posY) || 0; }
    mapaBloqueado = Boolean(estado.mapaBloqueado);
    if (Array.isArray(estado.bibliotecaTokens)) { bibliotecaTokens = estado.bibliotecaTokens; renderizarBibliotecaTokens(); }
    if (Array.isArray(estado.desenhos)) desenhos = estado.desenhos;
    if (Array.isArray(estado.areasEfeito)) areasEfeito = estado.areasEfeito;
    if (estado.nevoa) { nevoa = { ativada: Boolean(estado.nevoa.ativada), raioFt: [30,60,90,120].includes(Number(estado.nevoa.raioFt)) ? Number(estado.nevoa.raioFt) : 60, modoExploracao: estado.nevoa.modoExploracao === "dinamica" ? "dinamica" : "persistente", revelacoes: Array.isArray(estado.nevoa.revelacoes) ? estado.nevoa.revelacoes : [], marcasManuais: Array.isArray(estado.nevoa.marcasManuais) ? estado.nevoa.marcasManuais.map(m=>({...m,forma:m.forma==="quadrado"?"quadrado":"circulo"})) : [], paredes: Array.isArray(estado.nevoa.paredes) ? estado.nevoa.paredes : [] }; el("ativarNevoa").checked = nevoa.ativada; el("raioNevoa").value = String(nevoa.raioFt); el("modoNevoa").value = nevoa.modoExploracao; }
    atualizarMapa();
    if (Array.isArray(estado.objetos)) renderizarObjetos(estado.objetos);
    renderizarNevoa(); renderizarDesenhos(); atualizarPermissoes();
    if (Number.isFinite(Number(estado.pesPorQuadrado))) {
        escalaGradeFt = Number(estado.pesPorQuadrado); pesPorQuadrado.value = String(escalaGradeFt);
        document.querySelectorAll(".objeto-cenario[data-tipo='token']").forEach(item => aplicarDimensoes(item, { tipo: "token", tamanhoFt: Number(item.dataset.tamanhoFt) || 5 }));
        renderizarNevoa();
    }
});
socket.on("objetos-atualizados", objetos => { if (Array.isArray(objetos)) renderizarObjetos(objetos); });
alternarVisibilidadeToken.addEventListener("click", () => { if(!objetoSelecionado || objetoSelecionado.dataset.tipo!=="token") return; socket.emit("alternar-token-oculto",{id:objetoSelecionado.id},r=>{ if(!r?.ok) mensagemSala.textContent=r?.mensagem||"Não foi possível alterar a visibilidade."; else { mensagemSala.textContent=r.mensagem; fecharMenuObjeto(); } }); });
socket.on("biblioteca-tokens-atualizada", tokens => { bibliotecaTokens = Array.isArray(tokens) ? tokens : []; renderizarBibliotecaTokens(); });
socket.on("visao-token-atualizada", dados => { const item=el(dados.id); if(item){ item.dataset.visaoFt=String(dados.visaoFt); if(item===objetoSelecionado) atualizarControlesItem(); renderizarNevoa(); } });
socket.on("objeto-renomeado", dados => {
    const item = el(dados.id); if (!item) return;
    item.dataset.nome = dados.nome; item.title = `${dados.nome} — clique para selecionar; DEL para apagar`;
    const rotulo = item.querySelector?.(".rotulo-token"); if (rotulo) rotulo.textContent = dados.nome;
    if (item === objetoSelecionado) atualizarControlesItem();
    renderizarBibliotecaTokens();
});
socket.on("objeto-movido", dados => {
    const item = el(dados.id); if (!item || !Number.isFinite(dados.left) || !Number.isFinite(dados.top)) return;
    item.style.left = `${dados.left}px`; item.style.top = `${dados.top}px`; renderizarNevoa();
});
socket.on("objeto-rotacionado", dados => {
    const item=el(dados.id); if(!item || item.dataset.tipo!=="token") return;
    item.dataset.rotacao=String(dados.rotacao); item.style.transform=`rotate(${dados.rotacao}deg)`;
});
socket.on("objeto-redimensionado", dados => {
    const item = el(dados.id); if (!item) return;
    aplicarDimensoes(item, { tipo: item.dataset.tipo, largura: dados.largura, tamanhoFt: dados.tamanhoFt });
    if (item === objetoSelecionado) atualizarControlesItem(); renderizarNevoa();
});
socket.on("escala-grade-atualizada", dados => {
    escalaGradeFt = Number(dados.pesPorQuadrado) || 5;
    pesPorQuadrado.value = String(escalaGradeFt);
    document.querySelectorAll(".objeto-cenario[data-tipo='token']").forEach(item => {
        aplicarDimensoes(item, { tipo: "token", tamanhoFt: Number(item.dataset.tamanhoFt) || 5 });
    });
    atualizarControlesItem(); renderizarDesenhos(); renderizarNevoa();
});

socket.on("grade-visual-atualizada", dados => {
    if (!dados) return;
    if (Number.isFinite(Number(dados.gradePx))) gradePx = Math.max(8, Math.min(180, Number(dados.gradePx)));
    if (Number.isFinite(Number(dados.gradeX))) gradeX = Number(dados.gradeX);
    if (Number.isFinite(Number(dados.gradeY))) gradeY = Number(dados.gradeY);
    atualizarMapa(); renderizarDesenhos(); renderizarNevoa();
});
function ajustarTamanhoGrade(fator) {
    if (!estaEmUmaSala()) return;
    const novo = Math.max(8, Math.min(180, Math.round(gradePx * fator * 10) / 10));
    socket.emit("alterar-grade-visual", { gradePx: novo });
}
el("diminuirGrade").addEventListener("click", () => ajustarTamanhoGrade(.95));
el("aumentarGrade").addEventListener("click", () => ajustarTamanhoGrade(1.05));
el("detectarGradeAgora").addEventListener("click", async () => {
    if (!objetoSelecionado || objetoSelecionado.dataset.tipo !== "mapa" || !objetoSelecionado.src) {
        mensagemSala.textContent = "Selecione primeiro um mapa enviado para a mesa."; return;
    }
    mensagemSala.textContent = "Analisando a grade do mapa selecionado...";
    const detectada = await detectarGrade(objetoSelecionado.src);
    if (!detectada) { mensagemSala.textContent = "Não consegui identificar a grade com confiança. Tente +Grade/-Grade para ajustar manualmente."; return; }
    socket.emit("calibrar-grade-mapa", { id: objetoSelecionado.id, gradeDetectada: detectada }, resposta => {
        mensagemSala.textContent = resposta?.mensagem || "Ajuste de grade enviado.";
    });
});

let redimensionandoToken=null;
function iniciarRedimensionamentoToken(evento) {
    if(evento.button!==0 || !objetoSelecionado || objetoSelecionado.dataset.tipo!=="token" || !estaEmUmaSala()) return;
    evento.preventDefault(); evento.stopPropagation();
    redimensionandoToken={item:evento.currentTarget.closest(".objeto-token-wrapper"),inicioX:evento.clientX,inicioY:evento.clientY,tamanho:Number(objetoSelecionado.dataset.tamanhoFt)||5};
}
window.addEventListener("mousemove", evento => {
    if(!redimensionandoToken) return;
    const delta=Math.max(-500,Math.min(1000,Math.max(evento.clientX-redimensionandoToken.inicioX,evento.clientY-redimensionandoToken.inicioY)));
    const novo=Math.max(5,Math.min(200,Math.round((redimensionandoToken.tamanho+delta/gradePx*escalaGradeFt)/5)*5));
    aplicarDimensoes(redimensionandoToken.item,{tipo:"token",tamanhoFt:novo}); redimensionandoToken.item.dataset.tamanhoTemporario=String(novo); renderizarNevoa();
});
window.addEventListener("mouseup",()=>{ if(!redimensionandoToken)return; const r=redimensionandoToken; redimensionandoToken=null; const novo=Number(r.item.dataset.tamanhoTemporario)||Number(r.item.dataset.tamanhoFt)||5; delete r.item.dataset.tamanhoTemporario; enviarRedimensionamento(r.item,{tamanhoFt:novo}); });
function iniciarArrastoObjeto(evento) {
    // No modo Mover cenário, arrastar sobre um token/imagem move a visão, não o item.
    // Espaço + arrastar e o botão do meio também navegam.
    if (evento.button !== 0) return;
    if (modoFerramenta === "mover" || teclaEspacoPressionada) {
        evento.preventDefault();
        evento.stopPropagation();
        arrastando = true; alvoArrastado = cenario;
        inicioX = evento.clientX - posX; inicioY = evento.clientY - posY;
        areaVisualizacao.classList.add("navegando");
        return;
    }
    evento.preventDefault(); selecionarObjeto(evento.currentTarget); fecharMenuObjeto();
    if (mapaBloqueado && evento.currentTarget.dataset.tipo === "mapa") { mensagemSala.textContent = "A imagem do cenário está bloqueada. Desbloqueie-a para movê-la."; return; }
    arrastando = true; alvoArrastado = evento.currentTarget;
    inicioX = evento.clientX; inicioY = evento.clientY;
    objetoX = alvoArrastado.offsetLeft; objetoY = alvoArrastado.offsetTop;
}
const areaVisualizacao = el("mapaVisualizacao");
areaVisualizacao.addEventListener("mousedown", evento => {
    if (modoDesenharParedes && evento.button === 0 && papelExibido.textContent === "Mestre") { evento.preventDefault(); evento.stopPropagation(); arrastando=false; alvoArrastado=null; inicioParedeAtual=coordenadaCenario(evento); fimParedeAtual=inicioParedeAtual; renderizarNevoa(); return; }
    if (modoPincelNevoa && evento.button === 0 && papelExibido.textContent === "Mestre") { evento.preventDefault(); evento.stopPropagation(); arrastando=false; alvoArrastado=null; desenhandoNevoa=true; marcasNevoaAtual=[]; registrarMarcaNevoa(evento); return; }
    const gestoNavegacao = evento.button === 1 || (evento.button === 0 && (teclaEspacoPressionada || modoFerramenta === "mover"));
    if (gestoNavegacao) {
        evento.preventDefault();
        fecharMenuObjeto();
        arrastando = true; alvoArrastado = cenario;
        inicioX = evento.clientX - posX; inicioY = evento.clientY - posY;
        areaVisualizacao.classList.add("navegando");
        return;
    }
    if (evento.button !== 0) return;
    if (modoAreaEfeito && papelExibido.textContent === "Mestre") { evento.preventDefault(); evento.stopPropagation(); const p=coordenadaCenario(evento); areasEfeito.push({id:"area-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,6),tipo:el("tipoAreaEfeito").value,x:p.x,y:p.y,tamanhoFt:Number(el("tamanhoAreaEfeito").value)||20,angulo:0}); salvarAreasEfeito(); modoAreaEfeito=false; el("ferramentaAreaEfeito").classList.remove("ativo"); return; }
    if (evento.target.closest(".desenho-risco") || evento.target.closest(".area-efeito")) return;
    if (evento.target.closest(".objeto-cenario") || evento.target.closest(".animacao-dados") || evento.target.closest(".menu-objeto") || evento.target.closest(".menu-ferramentas-foco") || evento.target.closest(".botao-ferramentas-flutuante")) return;
    if (modoFerramenta === "desenho") { evento.preventDefault(); desenhandoAgora = true; pontosDesenhoAtual = [coordenadaCenario(evento)]; renderizarDesenhos(); return; }
    if (modoFerramenta === "regua") { evento.preventDefault(); pontoReguaInicio = coordenadaCenario(evento); pontoReguaFim = pontoReguaInicio; renderizarDesenhos(); return; }
    if (objetoSelecionado) objetoSelecionado.classList.remove("selecionado");
    objetoSelecionado = null; desenhoSelecionadoId = null; renderizarDesenhos(); atualizarControlesItem(); fecharMenuObjeto();
    arrastando = true; alvoArrastado = cenario; inicioX = evento.clientX - posX; inicioY = evento.clientY - posY;
    areaVisualizacao.classList.add("navegando");
});
window.addEventListener("mousemove", evento => {
    if (tokenRotacionando) {
        const rect = tokenRotacionando.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        const angulo = Math.atan2(evento.clientY - cy, evento.clientX - cx) * 180 / Math.PI - anguloInicialRotacao;
        aplicarRotacaoToken(tokenRotacionando, angulo, false);
        return;
    }
    if (inicioParedeAtual && modoDesenharParedes) { fimParedeAtual=coordenadaCenario(evento); renderizarNevoa(); return; }
    if (desenhandoNevoa) { registrarMarcaNevoa(evento); return; }
    if (desenhandoAgora) { pontosDesenhoAtual.push(coordenadaCenario(evento)); renderizarDesenhos(); return; }
    if (pontoReguaInicio && modoFerramenta === "regua") { pontoReguaFim = coordenadaCenario(evento); renderizarDesenhos(); return; }
    if (!arrastando || !alvoArrastado) return;
    if (alvoArrastado === cenario) { posX = evento.clientX - inicioX; posY = evento.clientY - inicioY; atualizarMapa(); return; }
    alvoArrastado.style.left = `${objetoX + (evento.clientX - inicioX) / zoom}px`;
    alvoArrastado.style.top = `${objetoY + (evento.clientY - inicioY) / zoom}px`;
});
window.addEventListener("mouseup", () => {
    if (tokenRotacionando) { const item=tokenRotacionando; tokenRotacionando=null; aplicarRotacaoToken(item, Number(item.dataset.rotacao||0), true); return; }
    if (inicioParedeAtual && modoDesenharParedes) { const a=inicioParedeAtual, b=fimParedeAtual||a; inicioParedeAtual=null; fimParedeAtual=null; renderizarNevoa(); if(Math.hypot(b.x-a.x,b.y-a.y)>4) { const paredes=[...(nevoa.paredes||[]),{x1:a.x,y1:a.y,x2:b.x,y2:b.y}]; socket.emit("salvar-paredes-nevoa",{paredes},r=>{ if(!r?.ok) mensagemSala.textContent=r?.mensagem||"Não foi possível salvar a parede."; }); } return; }
    if (desenhandoNevoa) { desenhandoNevoa=false; arrastando=false; alvoArrastado=null; areaVisualizacao.classList.remove("navegando"); if (marcasNevoaAtual.length) socket.emit("editar-nevoa-manual",{marcas:marcasNevoaAtual},r=>{if(!r?.ok)mensagemSala.textContent=r?.mensagem||"Não foi possível aplicar a nevoa.";}); marcasNevoaAtual=[]; renderizarNevoa(); return; }
    if (desenhandoAgora) { desenhandoAgora = false; const pontos = pontosDesenhoAtual.slice(); pontosDesenhoAtual = []; renderizarDesenhos(); if (estaEmUmaSala() && pontos.length > 1) socket.emit("adicionar-desenho", { pontos }, resposta => { if (!resposta?.ok) mensagemSala.textContent = resposta?.mensagem || "Não foi possível salvar o desenho."; }); return; }
    if (pontoReguaInicio && modoFerramenta === "regua") { pontoReguaInicio = null; pontoReguaFim = null; renderizarDesenhos(); return; }
    const alvoFinal = alvoArrastado;
    if (arrastando && alvoFinal && alvoFinal !== cenario && estaEmUmaSala()) {
        socket.emit("mover-objeto", { id: alvoFinal.id, left: parseFloat(alvoFinal.style.left), top: parseFloat(alvoFinal.style.top) });
    }
    arrastando = false; alvoArrastado = null;
    areaVisualizacao.classList.remove("navegando");
    if (alvoFinal === cenario) salvarVisualizacao();
});
areaVisualizacao.addEventListener("wheel", evento => {
    if (evento.target.closest(".menu-ferramentas-foco, .painel-atalho, .menu-objeto")) return;
    evento.preventDefault();
    const anterior = zoom;
    const fator = evento.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoom = Math.max(.2, Math.min(5, zoom * fator));
    const rect = areaVisualizacao.getBoundingClientRect();
    const mx = evento.clientX - rect.left - rect.width / 2;
    const my = evento.clientY - rect.top - rect.height / 2;
    posX = mx - (mx - posX) * (zoom / anterior);
    posY = my - (my - posY) * (zoom / anterior);
    atualizarMapa();
    salvarVisualizacao();
}, { passive: false });

function apagarObjetoSelecionado() {
    if (!estaEmUmaSala() || !objetoSelecionado) return;
    const id = objetoSelecionado.id;
    socket.emit("apagar-objeto", { id }, resposta => {
        if (!resposta?.ok) mensagemSala.textContent = resposta?.mensagem || "Não foi possível apagar o item.";
    });
    fecharMenuObjeto();
}
botaoApagarObjeto.addEventListener("click", apagarObjetoSelecionado);
window.addEventListener("keydown", evento => {
    const alvo = evento.target;
    if (alvo instanceof HTMLElement && (alvo.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName))) return;
    if (objetoSelecionado && objetoSelecionado.dataset.tipo === "token" && estaEmUmaSala() && ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(evento.key)) {
        evento.preventDefault();
        const passo = evento.shiftKey ? Math.max(1, gradePx) : 5;
        const dx = evento.key === "ArrowLeft" ? -passo : evento.key === "ArrowRight" ? passo : 0;
        const dy = evento.key === "ArrowUp" ? -passo : evento.key === "ArrowDown" ? passo : 0;
        const left = (parseFloat(objetoSelecionado.style.left)||0) + dx, top = (parseFloat(objetoSelecionado.style.top)||0) + dy;
        objetoSelecionado.style.left = `${left}px`; objetoSelecionado.style.top = `${top}px`;
        socket.emit("mover-objeto", {id:objetoSelecionado.id,left,top});
        renderizarNevoa(); return;
    }
    if (areaEfeitoSelecionadaId && papelExibido.textContent === "Mestre" && (evento.key.toLowerCase() === "q" || evento.key.toLowerCase() === "e")) {
        evento.preventDefault(); const delta=evento.key.toLowerCase()==="q"?-15:15; areasEfeito=areasEfeito.map(a=>a.id===areaEfeitoSelecionadaId?{...a,angulo:((Number(a.angulo)||0)+delta+360)%360}:a); salvarAreasEfeito(); renderizarDesenhos(); return;
    }
    if (objetoSelecionado && objetoSelecionado.dataset.tipo === "token" && estaEmUmaSala() && (evento.key.toLowerCase() === "q" || evento.key.toLowerCase() === "e")) {
        evento.preventDefault(); aplicarRotacaoToken(objetoSelecionado, Number(objetoSelecionado.dataset.rotacao||0) + (evento.key.toLowerCase()==="q"?-15:15)); return;
    }
    if (evento.key !== "Delete" && evento.key !== "Backspace") return;
    if (areaEfeitoSelecionadaId && papelExibido.textContent === "Mestre") { evento.preventDefault(); areasEfeito=areasEfeito.filter(a=>a.id!==areaEfeitoSelecionadaId); areaEfeitoSelecionadaId=null; salvarAreasEfeito(); renderizarDesenhos(); return; }
    if (desenhoSelecionadoId) { evento.preventDefault(); apagarDesenho(desenhoSelecionadoId); return; }
    if (!objetoSelecionado) return;
    evento.preventDefault(); apagarObjetoSelecionado();
});
window.addEventListener("mousedown", evento => {
    if (areaEfeitoSelecionadaId && !evento.target.closest(".area-efeito") && !evento.target.closest("#painelLateral, aside, .menu-ferramentas-foco")) { areaEfeitoSelecionadaId = null; renderizarDesenhos(); }
}, true);
window.addEventListener("mousedown", evento => {
    if (!evento.target.closest(".menu-objeto")) fecharMenuObjeto();
});

pesPorQuadrado.addEventListener("change", () => {
    const valor = Number(pesPorQuadrado.value);
    if (!Number.isFinite(valor) || valor < 1 || valor > 100) return;
    socket.emit("alterar-escala-grade", { pesPorQuadrado: valor }, resposta => {
        if (!resposta?.ok) mensagemSala.textContent = resposta?.mensagem || "Não foi possível alterar a escala da grade.";
    });
});
function redimensionarItemSelecionado(fator) {
    const item = objetoSelecionado;
    if (!item || !estaEmUmaSala()) return;
    if (item.dataset.tipo === "token") {
        const opcoes = [5, 10, 15, 20, 30, 40, 50];
        const atual = Number(item.dataset.tamanhoFt || 5);
        let novo = opcoes.reduce((melhor, v) => Math.abs(v - atual * fator) < Math.abs(melhor - atual * fator) ? v : melhor, opcoes[0]);
        enviarRedimensionamento(item, { tamanhoFt: novo });
    } else {
        const atual = Number(item.dataset.largura) || item.offsetWidth;
        const novo = Math.max(24, Math.min(5000, Math.round(atual * fator)));
        enviarRedimensionamento(item, { largura: novo });
    }
}
diminuirTamanhoItem.addEventListener("click", () => redimensionarItemSelecionado(.8));
aumentarTamanhoItem.addEventListener("click", () => redimensionarItemSelecionado(1.25));
aplicarTamanhoToken.addEventListener("click", () => {
    if (!objetoSelecionado || objetoSelecionado.dataset.tipo !== "token") return;
    enviarRedimensionamento(objetoSelecionado, { tamanhoFt: Number(tamanhoTokenFt.value) });
});

salvarNomeToken.addEventListener("click", () => {
    if (!objetoSelecionado || objetoSelecionado.dataset.tipo !== "token" || !estaEmUmaSala()) return;
    const nome = nomeTokenSelecionado.value.trim().slice(0, 40);
    if (!nome) { mensagemSala.textContent = "Digite um nome para o personagem."; return; }
    socket.emit("renomear-objeto", { id: objetoSelecionado.id, nome }, resposta => { if (!resposta?.ok) mensagemSala.textContent = resposta?.mensagem || "Não foi possível salvar o nome."; });
});
nomeTokenSelecionado.addEventListener("keydown", e => { if (e.key === "Enter") salvarNomeToken.click(); });

botaoDado.addEventListener("click", () => {
    if (!estaEmUmaSala()) { mensagemSala.textContent = "Entre em uma sala para rolar dados."; return; }
    const bonus = Number(bonusAtaque.value || 0);
    socket.emit("rolar-dados", { expressao: expressaoDados.value, bonus: bonus }, resposta => {
        if (!resposta?.ok) resultado.textContent = resposta?.mensagem || "Expressão de dados inválida.";
    });
});
socket.on("rolagem-realizada", dados => {
    const detalhes = dados.resultados.map(d => `${d.quantidade}d${d.lados}: [${d.valores.join(", ")}] = ${d.total}`).join(" + ");
    const bonusTexto = dados.bonus ? ` ${dados.bonus >= 0 ? "+" : "−"} ${Math.abs(dados.bonus)}` : "";
    const linha = `${dados.nome}: ${dados.expressao}${bonusTexto} = ${dados.total}`;
    resultado.textContent = `${linha}${detalhes ? " | " + detalhes : ""}`;
    animacaoDados.hidden = false; textoAnimacao.textContent = `${dados.nome} está rolando...`;
    resultadoAnimacao.textContent = ""; dadoAnimado.textContent = "🎲";
    if (temporizadorAnimacao) clearTimeout(temporizadorAnimacao);
    temporizadorAnimacao = setTimeout(() => {
        textoAnimacao.textContent = `${dados.nome} rolou ${dados.expressao}`;
        resultadoAnimacao.textContent = `Resultado: ${dados.total}`;
        dadoAnimado.textContent = "🎲";
        temporizadorAnimacao = setTimeout(() => { animacaoDados.hidden = true; }, 5000);
    }, 1300);
});

atualizarPermissoes(); atualizarMapa();
