const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

// ========================================
// FIREBASE
// ========================================
const serviceAccount = require("./firebase.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ========================================
const app = express();
app.use(express.json());

// ========================================
// CONFIG
// ========================================
const TOKEN = "EAALYR4Vve2QBQiGoYeC7sEKQ0vZCOC8xZARVgCEumYNTtZB4TqPVJNiEHMosSuguqCgnBvXsOZAnFqBb8wwZAZBlDW15ZCuacRBUVWXU7mRnRmkC9XyjD8ZCrkcPVyuF8FHu68KasQkWrQ6Efd0CGa6ZAAEWtGrgn3uQqECH9osYhm2So460bldE8P3X2Ga8hvLIbLQZDZD";
const PHONE_NUMBER_ID = "1008190442377078";
const VERIFY_TOKEN = "123456";

// ========================================
// ROTA RAIZ (HEALTH CHECK)
// ========================================
app.get("/", (req, res) => {
  res.status(200).send("BOT ONLINE 🚀");
});

// ========================================
// ENVIAR MENSAGEM
// ========================================
async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (e) {
    console.log("Erro ao enviar:", e.response?.data || e.message);
  }
}

// ========================================
// VERIFICAÇÃO WEBHOOK
// ========================================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const challenge = req.query["hub.challenge"];
  const token = req.query["hub.verify_token"];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ========================================
// RECEBER MENSAGENS
// ========================================
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body?.trim();

    console.log("Mensagem:", from, text);

    const restauranteId = "rest_01";

    const restDoc = await db.collection("restaurantes").doc(restauranteId).get();

    if (!restDoc.exists) {
      await sendMessage(from, "Restaurante não configurado.");
      return res.sendStatus(200);
    }

    const rest = restDoc.data();

    if (!rest.cardapio) {
      await sendMessage(from, "Cardápio não configurado.");
      return res.sendStatus(200);
    }

    const clienteRef = db.collection("clientes").doc(from);
    const clienteDoc = await clienteRef.get();

    // =========================
    // NOVO CLIENTE
    // =========================
    if (!clienteDoc.exists) {
      await clienteRef.set({
        etapa: "nome",
        restaurante: restauranteId,
      });

      await sendMessage(from, "Olá 👋\nQual seu nome?");
      return res.sendStatus(200);
    }

    const cliente = clienteDoc.data();

    // =========================
    // NOME
    // =========================
    if (cliente.etapa === "nome") {
      await clienteRef.update({
        nome: text,
        etapa: "endereco",
      });

      await sendMessage(from, "Perfeito 👍\nDigite seu endereço:");
      return res.sendStatus(200);
    }

    // =========================
    // ENDEREÇO
    // =========================
    if (cliente.etapa === "endereco") {
      await clienteRef.update({
        endereco: text,
        etapa: "menu",
      });

      let menu = "🍔 *Cardápio*\n";
      Object.keys(rest.cardapio).forEach((k) => {
        const p = rest.cardapio[k];
        menu += `${k}️⃣ ${p.nome} - R$${p.preco}\n`;
      });

      await sendMessage(from, menu);
      return res.sendStatus(200);
    }

    // =========================
    // MENU
    // =========================
    if (cliente.etapa === "menu") {
      const produto = rest.cardapio[text];

      if (!produto) {
        await sendMessage(from, "Opção inválida.");
        return res.sendStatus(200);
      }

      const taxa = rest.taxaEntrega || 0;

      const pedidoRef = await db.collection("pedidos").add({
        restaurante: restauranteId,
        cliente: from,
        nomeCliente: cliente.nome,
        endereco: cliente.endereco,
        itens: [produto],
        total: produto.preco + taxa,
        status: "montando",
        taxaEntrega: taxa,
      });

      await clienteRef.update({
        etapa: "carrinho",
        pedidoId: pedidoRef.id,
      });

      await sendMessage(
        from,
        `Adicionado 🛒\nEntrega: R$${taxa}\nTotal: R$${produto.preco + taxa}\n\n1 pagar\n2 adicionar mais`
      );

      return res.sendStatus(200);
    }

    // =========================
    // CARRINHO
    // =========================
    if (cliente.etapa === "carrinho") {
      const pedidoDoc = await db.collection("pedidos").doc(cliente.pedidoId).get();

      if (!pedidoDoc.exists) {
        await sendMessage(from, "Pedido não encontrado.");
        return res.sendStatus(200);
      }

      const pedido = pedidoDoc.data();

      if (text === "1") {
        await clienteRef.update({ etapa: "pagamento" });
        await db.collection("pedidos").doc(cliente.pedidoId).update({
          status: "aguardando_pagamento",
        });

        await sendMessage(
          from,
          `💳 Total R$${pedido.total}\n\n(Pix automático entra aqui)`
        );
      }

      if (text === "2") {
        await clienteRef.update({ etapa: "menu" });

        let menu = "🍔 *Cardápio*\n";
        Object.keys(rest.cardapio).forEach((k) => {
          const p = rest.cardapio[k];
          menu += `${k}️⃣ ${p.nome} - R$${p.preco}\n`;
        });

        await sendMessage(from, menu);
      }

      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (e) {
    console.log("ERRO:", e.response?.data || e.message);
    res.sendStatus(200);
  }
});

// ========================================
// START SERVER (IMPORTANTE PRO RAILWAY)
// ========================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor online na porta ${PORT} 🚀`);
});

// ========================================
// PROTEÇÃO ANTI CRASH
// ========================================
process.on("unhandledRejection", (err) => {
  console.log("Erro não tratado:", err);
});

process.on("uncaughtException", (err) => {
  console.log("Exceção:", err);
});
