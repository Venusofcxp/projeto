const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const serviceAccount = require("./firebase.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();
app.use(express.json());

const TOKEN = "EAALYR4Vve2QBQlfg2HwJkfOUKDN8jJpPZBPaiUQJ2ZAZCe0O7MRkZCaLqqlmLZCFdX3LXQceXehsOQUjWjbZAckh8ZCPpRez69bkWz1nex3gsEqCZAinRnSZAsO1j4ZC2pYZAKWS7LJSsRQCJZAFIPZA1KBikZAFdqfYAbbFrnyzmjySY92nAEMi7NRjcJBsb5WIouOdgjnZBBg9hXL8gevGk8hZCJG0GZC97rgR9tZAeTzYZAEtGZAyOvXicl6ipF2tZBFK6uZCMXrnQTQFZADulV05FbzcwZABcapQeGZAY";
const PHONE_NUMBER_ID = "1008190442377078";
const VERIFY_TOKEN = "123456";


// ========================================
// ROTA RAIZ (RAILWAY PRECISA)
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
    console.log("Erro ao enviar mensagem:", e.response?.data || e.message);
  }
}


// ========================================
// VERIFICAR WEBHOOK
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

    console.log("Mensagem recebida:", from, text);

    const restauranteId = "rest_01";
    const restRef = db.collection("restaurantes").doc(restauranteId);
    const restDoc = await restRef.get();

    // 🔥 SE NÃO EXISTIR RESTAURANTE → NÃO QUEBRA MAIS
    if (!restDoc.exists) {
      console.log("Restaurante não encontrado");
      await sendMessage(from, "Restaurante não configurado.");
      return res.sendStatus(200);
    }

    const rest = restDoc.data();

    if (!rest.cardapio) {
      console.log("Cardápio não encontrado");
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
    // PEGAR NOME
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
    // PEGAR ENDEREÇO
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

      const pedidoRef = await db.collection("pedidos").add({
        restaurante: restauranteId,
        cliente: from,
        nomeCliente: cliente.nome,
        endereco: cliente.endereco,
        itens: [produto],
        total: produto.preco + (rest.taxaEntrega || 0),
        status: "montando",
        taxaEntrega: rest.taxaEntrega || 0,
      });

      await clienteRef.update({
        etapa: "carrinho",
        pedidoId: pedidoRef.id,
      });

      await sendMessage(
        from,
        `Adicionado 🛒\nEntrega: R$${rest.taxaEntrega || 0}\nTotal: R$${produto.preco + (rest.taxaEntrega || 0)}\n\n1 pagar\n2 adicionar mais`
      );
      return res.sendStatus(200);
    }

    // =========================
    // CARRINHO
    // =========================
    if (cliente.etapa === "carrinho") {
      const pedidoRef = db.collection("pedidos").doc(cliente.pedidoId);
      const pedidoDoc = await pedidoRef.get();

      if (!pedidoDoc.exists) {
        await sendMessage(from, "Pedido não encontrado.");
        return res.sendStatus(200);
      }

      const pedido = pedidoDoc.data();

      if (text === "1") {
        await clienteRef.update({ etapa: "pagamento" });
        await pedidoRef.update({ status: "aguardando_pagamento" });

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
    console.log("ERRO GERAL:", e.response?.data || e.message);
    res.sendStatus(200); // nunca deixa o Railway matar
  }
});


// ========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Sistema rodando 🚀"));
