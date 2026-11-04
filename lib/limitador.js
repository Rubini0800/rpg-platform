"use strict";
// Limitador simples de janela fixa, em memória. Serve para frear abuso (criar salas em massa,
// adivinhar códigos, subir imagens sem parar). Não é compartilhado entre instâncias.
function criarLimitador({ max, janelaMs }) {
    const mapa = new Map();
    const faxina = setInterval(() => {
        const agora = Date.now();
        for (const [chave, e] of mapa) if (e.inicio + janelaMs < agora) mapa.delete(chave);
    }, Math.max(janelaMs, 60000));
    faxina.unref?.();
    function entrada(chave) {
        const agora = Date.now();
        let e = mapa.get(chave);
        if (!e || e.inicio + janelaMs < agora) { e = { inicio: agora, n: 0 }; mapa.set(chave, e); }
        return e;
    }
    return {
        permitir(chave) { const e = entrada(chave); if (e.n >= max) return false; e.n++; return true; },
        bloqueado(chave) { return entrada(chave).n >= max; },
        registrar(chave) { entrada(chave).n++; },
        parar() { clearInterval(faxina); },
    };
}
module.exports = { criarLimitador };
