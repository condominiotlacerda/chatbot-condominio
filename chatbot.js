// ======================================================================
// Chatbot WhatsApp – Render
// ======================================================================
// Este arquivo inicializa um servidor Express e um cliente whatsapp-web.js
// usando RemoteAuth com MongoDB (wwebjs-mongo). Inclui rotas /, /qr e /qrcode
// para verificação de saúde e exibição do QR Code no navegador.
// ======================================================================

// -------------------------
// Dependências
// -------------------------
const express = require('express');
const qrcode = require('qrcode'); // para gerar QR via rota HTTP
const { Client, RemoteAuth, MessageMedia } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// -------------------------
// Configurações do Servidor
// -------------------------
const PORT = process.env.PORT || 8000;
const app = express();
app.use(express.json());

// -------------------------
// Estados globais
// -------------------------
let lastQr = null;                  // QR Code mais recente
let isReady = false;                // Flag quando o WhatsApp conecta
let client = null;                  // Instância do whatsapp-web.js
let store = null;                   // Instância do MongoStore

// ======================================================================
// Conexão MongoDB para RemoteAuth (persistência da sessão)
// ======================================================================
// Observações importantes:
// - As opções { useNewUrlParser, useUnifiedTopology } são de versões antigas,
//   por isso foram removidas para evitar warnings com mongoose >= 7.
// - O erro que você viu ("Cannot read properties of undefined (reading 'collection')")
//   geralmente acontece quando o mongoose ainda não está conectado quando o
//   MongoStore tenta acessar connection.db. Por isso aqui **aguardamos** a
//   conexão antes de criar o store e o client.
// ======================================================================
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.warn('ATENÇÃO: MONGO_URI não definido nas variáveis de ambiente! O RemoteAuth precisa de MongoDB.');
}

// Função que garante conexão ativa do mongoose antes de prosseguir
async function connectMongo() {
  if (!MONGO_URI) {
    throw new Error(
      'MONGO_URI não foi definido. Configure a variável de ambiente MONGO_URI no Render para usar RemoteAuth.'
    );
  }
  if (mongoose.connection.readyState === 1) {
    // já conectado
    return;
  }
  await mongoose.connect(MONGO_URI);
  // aguarda estar "ready"
  await mongoose.connection.asPromise();
  console.log('MongoDB conectado (para RemoteAuth).');
}

// ======================================================================
// Rotas HTTP
// ======================================================================

// Rota de saúde / status básico
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'O servidor está ativo. O chatbot está pronto para ser inicializado.',
  });
});

// Rota antiga mantida por compatibilidade
app.get('/qr', async (req, res) => {
  try {
    if (!lastQr) {
      return res
        .status(200)
        .send('<p>Nenhum QR Code disponível no momento. Aguarde o evento "qr" e recarregue.</p>');
    }
    const qrImage = await qrcode.toDataURL(lastQr);
    res.status(200).send(`
      <html>
        <head>
          <meta charset="utf-8" />
          <title>QR Code - WhatsApp</title>
        </head>
        <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto;">
          <h2>Escaneie o QR Code no WhatsApp</h2>
          <img src="${qrImage}" alt="QR Code" />
          <p>Se o QR expirar, recarregue a página.</p>
          <p><a href="/qrcode">Versão com auto-refresh</a></p>
        </body>
      </html>
    `);
  } catch (e) {
    console.error('Falha ao gerar o QR Code em /qr:', e);
    res.status(500).send('Falha ao gerar o QR Code.');
  }
});

// Nova rota com auto-refresh suave (cada 8s) enquanto não conectado
app.get('/qrcode', async (req, res) => {
  try {
    if (isReady) {
      return res.status(200).send(`
        <html>
          <head>
            <meta charset="utf-8" />
            <title>WhatsApp conectado</title>
          </head>
          <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto;">
            <h2>✅ WhatsApp conectado!</h2>
            <p>O dispositivo já está pareado. Você pode fechar esta página.</p>
            <p><a href="/">Voltar</a></p>
          </body>
        </html>
      `);
    }

    // Se ainda não temos QR, mostra tela de espera com auto-refresh
    if (!lastQr) {
      return res.status(200).send(`
        <html>
          <head>
            <meta charset="utf-8" />
            <meta http-equiv="refresh" content="8" />
            <title>Aguardando QR Code...</title>
          </head>
          <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto;">
            <h2>Gerando QR Code...</h2>
            <p>Se esta página não atualizar, aguarde alguns segundos. Ela recarrega automaticamente.</p>
            <p><a href="/qrcode">Recarregar agora</a></p>
          </body>
        </html>
      `);
    }

    const qrImage = await qrcode.toDataURL(lastQr);
    res.status(200).send(`
      <html>
        <head>
          <meta charset="utf-8" />
          <meta http-equiv="refresh" content="8" />
          <title>QR Code - WhatsApp</title>
          <style>
            body { font-family: system-ui, -apple-system, Segoe UI, Roboto; display:flex; align-items:center; justify-content:center; min-height:100vh; background:#f6f7f9; }
            .card { background:#fff; padding:28px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,0.07); text-align:center; width: 420px; }
            img { width: 100%; height: auto; border-radius:12px; }
            .muted { color:#666; font-size:14px; }
            a { text-decoration:none; }
            .row { margin-top:12px; display:flex; gap:8px; justify-content:center; }
            .btn { border:1px solid #ddd; padding:8px 12px; border-radius:10px; background:#fff; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Escaneie o QR Code</h2>
            <img src="${qrImage}" alt="QR Code" />
            <p class="muted">Esta página atualiza sozinha a cada 8 segundos enquanto o QR estiver ativo.</p>
            <div class="row">
              <a class="btn" href="/">Home</a>
              <a class="btn" href="/qrcode">Atualizar</a>
              <a class="btn" href="/qr">Versão simples</a>
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (e) {
    console.error('Falha ao gerar o QR Code em /qrcode:', e);
    res.status(500).send('Falha ao gerar o QR Code.');
  }
});

// ======================================================================
// Config do Chatbot (menus, lógica, etc.)
// ======================================================================
const CONFIG = {
  TIMEOUT: 180000,
  VALID_APARTMENTS: ['1', '101', '102', '201', '202', '301', '302', '401'],
  BOLETO_TYPES: ['condominio', '1', '2', '3'],
  AUTHORIZED_USERS: {
    '558586282980': { name: 'João Paulo', apartment: '1' },
    '558597294028': { name: 'José Rocha', apartment: '1' },
    '558588402222': { name: 'Lizandro', apartment: '101' },
    '558598271656': { name: 'Felipe Granja', apartment: '102' },
    '558599840514': { name: 'Jorge', apartment: '201' },
    '558596540289': { name: 'Ângela', apartment: '201' },
    '558598274259': { name: 'João Marcelo', apartment: '301' },
    '553193318992': { name: 'Nica', apartment: '301' },
    '558581837401': { name: 'Marcela', apartment: '301' },
    '558589945558': { name: 'Suzane', apartment: '302' },
    '558599339889': { name: 'Célia', apartment: '401' },
  },
};

// Estado em memória
const stateManager = {
  states: {},
  timeouts: {},
  lastMessageIds: {},
  logFiles: {}, // compatibilidade; não gravamos em disco no Render
};

// Utils
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeMessage = (text) =>
  text?.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const normalizePhoneNumber = (number) => number.split('@')[0];

// Log (somente console no Render)
function logInteraction(userNumber, userInfo, message, type = 'user_message') {
  const timestamp = new Date().toISOString();
  let logMessage = '';
  switch (type) {
    case 'user_message':
      logMessage = `[${timestamp}] Usuário ${userInfo?.name || 'desconhecido'} (${userNumber}) digitou: "${message}"`;
      break;
    case 'file_sent':
      logMessage = `[${timestamp}] Arquivo enviado para ${userInfo?.name || 'desconhecido'} (${userNumber}): ${message}`;
      break;
    case 'system_message':
      logMessage = `[${timestamp}] Sistema para ${userInfo?.name || 'desconhecido'} (${userNumber}): ${message}`;
      break;
    case 'error':
      logMessage = `[${timestamp}] Erro para ${userInfo?.name || 'desconhecido'} (${userNumber}): ${message}`;
      break;
  }
  console.log(logMessage);
}

// ------------------
// Handlers principais
// ------------------
const handlers = {
  async resetConversation(userNumber) {
    clearTimeout(stateManager.timeouts[userNumber]);
    delete stateManager.states[userNumber];
    delete stateManager.timeouts[userNumber];
    delete stateManager.lastMessageIds[userNumber];

    const userInfo = CONFIG.AUTHORIZED_USERS[normalizePhoneNumber(userNumber)];
    const exitMessage = 'Você saiu da conversa. Digite "oi" para iniciar novamente.';
    await client.sendMessage(userNumber, exitMessage);
    logInteraction(userNumber, userInfo, exitMessage, 'system_message');
    delete stateManager.logFiles[userNumber];
  },

  setTimeout(userNumber) {
    clearTimeout(stateManager.timeouts[userNumber]);
    stateManager.timeouts[userNumber] = setTimeout(async () => {
      const userInfo = CONFIG.AUTHORIZED_USERS[normalizePhoneNumber(userNumber)];
      const timeoutMessage =
        'Fim de conversa por inatividade. Digite "oi" para iniciar novamente.';
      await client.sendMessage(userNumber, timeoutMessage);
      logInteraction(userNumber, userInfo, timeoutMessage, 'system_message');
      handlers.resetConversation(userNumber);
    }, CONFIG.TIMEOUT);
  },

  async sendUnauthorizedMessage(userNumber) {
    await client.sendMessage(
      userNumber,
      `Este número (${userNumber}) não está autorizado. Por favor, entre em contato com o administrador da Assistente Virtual para cadastrar seu número.`
    );
  },

  async sendMainMenu(userNumber, userInfo, isInitial = true) {
    stateManager.states[userNumber] = 'main_menu';
    handlers.setTimeout(userNumber);

    const menuOptions =
      'Digite uma opção:\n' +
      '1 - Boletos\n' +
      '2 - Prestação de contas\n' +
      '3 - Notificações\n' +
      '4 - Previsão de despesas\n' +
      '5 - Seu dinheiro\n' +
      '6 - Histórico\n\n' +
      'Para sair digite "sair" ou "s"';

    if (isInitial) {
      try {
        const media = MessageMedia.fromFilePath(
          path.join(__dirname, 'imagens', 'lacerda_assistente.png')
        );
        await client.sendMessage(userNumber, media);
        logInteraction(userNumber, userInfo, 'Imagem lacerda_assistente.png enviada', 'file_sent');
      } catch (error) {
        logInteraction(
          userNumber,
          userInfo,
          `Erro ao enviar imagem: ${error?.message}`,
          'error'
        );
        await client.sendMessage(userNumber, 'Erro ao enviar imagem da Assistente Virtual.');
        logInteraction(
          userNumber,
          userInfo,
          'Erro ao enviar imagem da Assistente Virtual',
          'system_message'
        );
      }

      const welcomeMessage = `Olá, ${userInfo.name}! Eu sou a Lacerda, assistente virtual do Condomínio T Lacerda.\n\n${menuOptions}`;
      await client.sendMessage(userNumber, welcomeMessage);
      logInteraction(userNumber, userInfo, welcomeMessage, 'system_message');
    } else {
      await client.sendMessage(userNumber, menuOptions);
      logInteraction(userNumber, userInfo, menuOptions, 'system_message');
    }
  },

  async handleBoletos(userNumber, chat, userInfo) {
    console.log('--- DEBUG: A FUNÇÃO HANDLEBOLETOS FOI CHAMADA ---');
    const apartment = userInfo.apartment;
    await chat.sendStateTyping();
    await delay(500);

    const boletosFilePath = path.join(__dirname, 'dados', 'boletos_entrega.json');

    try {
      const boletosData = fs.readFileSync(boletosFilePath, 'utf8');
      const boletosJson = JSON.parse(boletosData);

      const apartmentBoletos = boletosJson[`apto_${apartment}`];

      if (apartmentBoletos) {
        const boletosList = apartmentBoletos
          .split('\n')
          .filter(
            (b) =>
              b.startsWith('1.') ||
              b.startsWith('2.') ||
              b.startsWith('3.') ||
              b.startsWith('4.')
          );

        if (boletosList.length > 0) {
          await client.sendMessage(
            userNumber,
            `Enviando ${boletosList.length} boletos para o apartamento ${apartment}:`
          );
          logInteraction(
            userNumber,
            userInfo,
            `Enviando ${boletosList.length} boletos para o apartamento ${apartment}:`,
            'system_message'
          );

          for (let i = 0; i < boletosList.length; i++) {
            const boletoInfo = boletosList[i];
            const boletoNumber = boletoInfo.split('.')[0];
            let boletoType = '';

            if (boletoNumber === '1') boletoType = 'condominio';
            else if (boletoNumber === '2') boletoType = '1';
            else if (boletoNumber === '3') boletoType = '2';
            else if (boletoNumber === '4') boletoType = '3';

            if (boletoType) {
              const filename = `boleto_tx_${boletoType}_apto_${apartment}.pdf`;
              const filePath = path.join(__dirname, 'pdfs', 'boletos', filename);

              try {
                const media = MessageMedia.fromFilePath(filePath);
                await client.sendMessage(userNumber, media, {
                  sendMediaAsDocument: true,
                  filename,
                });
                logInteraction(userNumber, userInfo, filename, 'file_sent');
                await delay(500);
              } catch (error) {
                logInteraction(
                  userNumber,
                  userInfo,
                  `Erro ao enviar ${filename}: ${error?.message}`,
                  'error'
                );
                const human = boletoInfo.split(' ')[1] || filename;
                await client.sendMessage(
                  userNumber,
                  `Erro ao enviar o boleto ${human}. Verifique se o arquivo ${filename} existe na pasta 'pdfs/boletos'.`
                );
                logInteraction(
                  userNumber,
                  userInfo,
                  `Erro ao enviar o boleto ${human}. Verifique se o arquivo ${filename} existe na pasta 'pdfs/boletos'.`,
                  'system_message'
                );
              }
            }
          }
        } else {
          await client.sendMessage(
            userNumber,
            `Não há boletos disponíveis para o apartamento ${apartment} no momento.`
          );
          logInteraction(
            userNumber,
            userInfo,
            `Não há boletos disponíveis para o apartamento ${apartment} no momento.`,
            'system_message'
          );
        }
      } else {
        await client.sendMessage(
          userNumber,
          `Não foram encontradas informações de boletos para o apartamento ${apartment}.`
        );
        logInteraction(
          userNumber,
          userInfo,
          `Não foram encontradas informações de boletos para o apartamento ${apartment}.`,
          'system_message'
        );
      }

      const optionsMessage = '\nDigite 0 para voltar ao menu inicial ou "s" para sair.';
      await client.sendMessage(userNumber, optionsMessage);
      logInteraction(userNumber, userInfo, optionsMessage, 'system_message');
      stateManager.states[userNumber] = 'boletos_menu';
    } catch (error) {
      console.error('Erro ao ler/processar o arquivo de boletos:', error);
      await client.sendMessage(
        userNumber,
        'Ocorreu um erro ao processar os boletos. Por favor, tente novamente mais tarde.'
      );
      logInteraction(
        userNumber,
        userInfo,
        `Erro ao ler/processar o arquivo de boletos: ${error?.message}`,
        'error'
      );
      stateManager.states[userNumber] = 'main_menu';
    }
  },

  async handleContasMenu(userNumber, chat, userInfo) {
    stateManager.states[userNumber] = 'contas_mes_selection';
    handlers.setTimeout(userNumber);
    const meses = [
      'Janeiro',
      'Fevereiro',
      'Março',
      'Abril',
      'Maio',
      'Junho',
      'Julho',
      'Agosto',
      'Setembro',
      'Outubro',
      'Novembro',
      'Dezembro',
    ];
    let message = 'Escolha o mês da prestação de contas:\n';
    for (let i = 0; i < meses.length; i++) {
      message += `${i + 1} - ${meses[i]}\n`;
    }
    message += '\nDigite 0 para voltar ao menu inicial ou "s" para sair.';
    await client.sendMessage(userNumber, message);
    logInteraction(userNumber, userInfo, message, 'system_message');
  },

  async handleContas(userNumber, chat, userInfo, mesSelecionado) {
    await chat.sendStateTyping();
    await delay(500);

    const anoAtual = new Date().getFullYear();
    const nomeMeses = [
      'janeiro',
      'fevereiro',
      'março',
      'abril',
      'maio',
      'junho',
      'julho',
      'agosto',
      'setembro',
      'outubro',
      'novembro',
      'dezembro',
    ];

    if (mesSelecionado >= 1 && mesSelecionado <= 12) {
      const nomeMesPasta = nomeMeses[mesSelecionado - 1].substring(0, 3);
      const mesPastaCompleta = `${mesSelecionado}.${nomeMesPasta}`;
      const contasPath = path.join(
        __dirname,
        'pdfs',
        'contas',
        String(anoAtual),
        mesPastaCompleta,
        'prestacao_contas.pdf'
      );
      const nomeMesPorExtenso = nomeMeses[mesSelecionado - 1];
      const filename = `prestacao_contas_${nomeMesPorExtenso}_${anoAtual}.pdf`;

      try {
        const media = MessageMedia.fromFilePath(contasPath);
        await client.sendMessage(userNumber, media, {
          sendMediaAsDocument: true,
          filename,
        });
        logInteraction(userNumber, userInfo, filename, 'file_sent');
        await delay(500);
        const optionsMessage = '\nDigite 0 para voltar ao menu de meses ou "s" para sair.';
        await client.sendMessage(userNumber, optionsMessage);
        logInteraction(userNumber, userInfo, optionsMessage, 'system_message');
        stateManager.states[userNumber] = 'contas_navigation';
      } catch (error) {
        logInteraction(
          userNumber,
          userInfo,
          `Erro ao enviar prestação de contas de ${nomeMesPorExtenso}: ${error?.message}`,
          'error'
        );
        await client.sendMessage(
          userNumber,
          `Erro ao enviar a prestação de contas de ${nomeMesPorExtenso}. Verifique se o arquivo existe.`
        );
        logInteraction(
          userNumber,
          userInfo,
          `Erro ao enviar a prestação de contas de ${nomeMesPorExtenso}. Verifique se o arquivo existe.`,
          'system_message'
        );
      }
    }
  },

  async handleNotificacoes(userNumber, chat, userInfo) {
    console.log('--- DEBUG: A FUNÇÃO HANDLENOTIFICACOES FOI CHAMADA ---');
    const apartment = userInfo.apartment;
    await chat.sendStateTyping();
    await delay(500);

    const notificacoesFilePath = path.join(__dirname, 'dados', 'notificacoes.json');

    try {
      const notificacoesData = fs.readFileSync(notificacoesFilePath, 'utf8');
      const notificacoesJson = JSON.parse(notificacoesData);

      const apartmentNotifications = notificacoesJson[`apto_${apartment}`];

      if (apartmentNotifications) {
        const notificationsList = apartmentNotifications
          .split('\n')
          .filter(
            (n) =>
              n.startsWith('1.') ||
              n.startsWith('2.') ||
              n.startsWith('3.') ||
              n.startsWith('4.')
          );

        if (notificationsList.length > 0) {
          await client.sendMessage(
            userNumber,
            `Enviando ${notificationsList.length} notificações para o apartamento ${apartment}:`
          );
          logInteraction(
            userNumber,
            userInfo,
            `Enviando ${notificationsList.length} notificações para o apartamento ${apartment}:`,
            'system_message'
          );

          for (const notification of notificationsList) {
            const notificationNumber = notification.split('.')[0];
            const filename = `notificacao_${notificationNumber}_apto_${apartment}.pdf`;
            const filePath = path.join(__dirname, 'notificacoes', filename);

            try {
              const media = MessageMedia.fromFilePath(filePath);
              await client.sendMessage(userNumber, media, {
                sendMediaAsDocument: true,
                filename,
              });
              logInteraction(userNumber, userInfo, filename, 'file_sent');
              await delay(500);
            } catch (error) {
              logInteraction(
                userNumber,
                userInfo,
                `Erro ao enviar ${filename}: ${error?.message}`,
                'error'
              );
              await client.sendMessage(
                userNumber,
                `Erro ao enviar a notificação ${notificationNumber}. Verifique se o arquivo ${filename} existe na pasta 'notificacoes'.`
              );
              logInteraction(
                userNumber,
                userInfo,
                `Erro ao enviar a notificação ${notificationNumber}. Verifique se o arquivo ${filename} existe na pasta 'notificacoes'.`,
                'system_message'
              );
            }
          }
        } else {
          await client.sendMessage(
            userNumber,
            `Não há notificações para o apartamento ${apartment} no momento.`
          );
          logInteraction(
            userNumber,
            userInfo,
            `Não há notificações para o apartamento ${apartment} no momento.`,
            'system_message'
          );
        }
      } else {
        await client.sendMessage(
          userNumber,
          `Não foram encontradas informações de notificações para o apartamento ${apartment}.`
        );
        logInteraction(
          userNumber,
          userInfo,
          `Não foram encontradas informações de notificações para o apartamento ${apartment}.`,
          'system_message'
        );
      }

      const optionsMessage = '\nDigite 0 para voltar ao menu inicial ou "s" para sair.';
      await client.sendMessage(userNumber, optionsMessage);
      logInteraction(userNumber, userInfo, optionsMessage, 'system_message');
      stateManager.states[userNumber] = 'returning_to_main_menu';
    } catch (error) {
      console.error('Erro ao ler/processar o arquivo de notificações:', error);
      await client.sendMessage(
        userNumber,
        'Ocorreu um erro ao processar as notificações. Por favor, tente novamente mais tarde.'
      );
      logInteraction(
        userNumber,
        userInfo,
        `Erro ao ler/processar o arquivo de notificações: ${error?.message}`,
        'error'
      );
      stateManager.states[userNumber] = 'main_menu';
    }
  },

  async handleHistorico(userNumber, chat, userInfo) {
    console.log('--- DEBUG: A FUNÇÃO HANDLEHISTORICO FOI CHAMADA ---');
    await chat.sendStateTyping();
    await delay(500);

    const historicoPath = path.join(__dirname, 'historico', 'historico.pdf');
    const filename = 'historico.pdf';

    try {
      const media = MessageMedia.fromFilePath(historicoPath);
      await client.sendMessage(userNumber, media, {
        sendMediaAsDocument: true,
        filename,
      });
      logInteraction(userNumber, userInfo, filename, 'file_sent');
      await delay(500);
      const optionsMessage = '\nDigite 0 para voltar ao menu inicial ou "s" para sair.';
      await client.sendMessage(userNumber, optionsMessage);
      logInteraction(userNumber, userInfo, optionsMessage, 'system_message');
      stateManager.states[userNumber] = 'historico_menu';
    } catch (error) {
      logInteraction(
        userNumber,
        userInfo,
        `Erro ao enviar ${filename}: ${error?.message}`,
        'error'
      );
      await client.sendMessage(
        userNumber,
        `Erro ao enviar o histórico. Verifique se o arquivo ${filename} existe na pasta 'historico'.`
      );
      logInteraction(
        userNumber,
        userInfo,
        `Erro ao enviar o histórico. Verifique se o arquivo ${filename} existe na pasta 'historico'.`,
        'system_message'
      );
    }
  },
};

// ======================================================================
// Inicialização do WhatsApp Client
// ======================================================================
async function createWhatsappClient() {
  // Cria o MongoStore com a conexão já ativa
  store = new MongoStore({ mongoose });

  // Instancia o cliente
  client = new Client({
    authStrategy: new RemoteAuth({
      store,
      clientId: 'session-01', // identificador da sessão no Mongo
      backupSyncIntervalMs: 300000,
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--single-process', // Em algumas plataformas como Render ajuda
      ],
    },
  });

  // ---------------------
  // Eventos do cliente
  // ---------------------
  client.on('qr', (qr) => {
    console.log('QR Code gerado. Acesse /qrcode para escanear no celular.');
    lastQr = qr; // salva para as rotas /qr e /qrcode renderizarem
    isReady = false;
  });

  client.on('ready', () => {
    console.log('WhatsApp conectado!');
    lastQr = null;
    isReady = true;
  });

  client.on('disconnected', (reason) => {
    console.log('Cliente desconectado:', reason);
    isReady = false;
  });

  // ---------------------
  // Handler de mensagens
  // ---------------------
  client.on('message', async (msg) => {
    const userNumber = msg.from;
    const normalizedNumber = normalizePhoneNumber(userNumber);
    const normalizedBody = normalizeMessage(msg.body);
    const chat = await msg.getChat();

    console.log(`Número recebido: ${userNumber} | Normalizado: ${normalizedNumber}`);

    const userInfo = CONFIG.AUTHORIZED_USERS[normalizedNumber];
    if (!userInfo) {
      await handlers.sendUnauthorizedMessage(userNumber);
      return;
    }

    logInteraction(userNumber, userInfo, msg.body);

    // Evita processar a mesma mensagem duas vezes
    if (stateManager.lastMessageIds[userNumber] === msg.id.id) return;
    stateManager.lastMessageIds[userNumber] = msg.id.id;

    // Comandos globais
    if (['sair', 's'].includes(normalizedBody)) {
      await handlers.resetConversation(userNumber);
      return;
    }

    if (['oi', 'ola'].includes(normalizedBody)) {
      await handlers.sendMainMenu(userNumber, userInfo, true);
      return;
    }

    // Roteamento por estado
    switch (stateManager.states[userNumber]) {
      case 'main_menu':
        if (normalizedBody === '1') {
          await handlers.handleBoletos(userNumber, chat, userInfo);
        } else if (normalizedBody === '2') {
          await handlers.handleContasMenu(userNumber, chat, userInfo);
        } else if (normalizedBody === '3') {
          await handlers.handleNotificacoes(userNumber, chat, userInfo);
        } else if (normalizedBody === '4') {
          await chat.sendStateTyping();
          await delay(500);

          const despesasPath = path.join(
            __dirname,
            'previsao_despesas',
            'previsao_despesas.pdf'
          );
          const filename = 'previsao_despesas.pdf';

          try {
            const media = MessageMedia.fromFilePath(despesasPath);
            await client.sendMessage(userNumber, media, {
              sendMediaAsDocument: true,
              filename,
            });
            logInteraction(userNumber, userInfo, filename, 'file_sent');
            await delay(500);
            const optionsMessage = '\nDigite 0 para voltar ao menu inicial ou "s" para sair.';
            await client.sendMessage(userNumber, optionsMessage);
            logInteraction(userNumber, userInfo, optionsMessage, 'system_message');
            stateManager.states[userNumber] = 'previsao_despesas_menu';
          } catch (error) {
            logInteraction(
              userNumber,
              userInfo,
              `Erro ao enviar ${filename}: ${error?.message}`,
              'error'
            );
            await client.sendMessage(
              userNumber,
              `Erro ao enviar a previsão de despesas. Verifique se o arquivo ${filename} existe na pasta 'previsao_despesas'.`
            );
            logInteraction(
              userNumber,
              userInfo,
              `Erro ao enviar a previsão de despesas. Verifique se o arquivo ${filename} existe na pasta 'previsao_despesas'.`,
              'system_message'
            );
          }
        } else if (normalizedBody === '5') {
          await chat.sendStateTyping();
          await delay(500);
          const submenuMessage =
            'Escolha uma opção de "Seu dinheiro":\n' +
            '1 - Seu dinheiro 1\n' +
            '2 - Seu dinheiro 2\n\n' +
            'Digite 0 para voltar ao menu principal ou "s" para sair.';
          await client.sendMessage(userNumber, submenuMessage);
          logInteraction(userNumber, userInfo, 'Exibiu submenu Seu dinheiro', 'system_message');
          stateManager.states[userNumber] = 'seu_dinheiro_submenu';
        } else if (normalizedBody === '6') {
          await handlers.handleHistorico(userNumber, chat, userInfo);
        } else {
          const invalidMessage =
            `Opção inválida: "${msg.body}". ` +
            'Escolha 1 para Boletos, 2 para Prestação de contas, 3 para Notificações, 4 para Previsão de despesas, 5 para Seu dinheiro, 6 para Histórico ou "s" para sair.';
          await client.sendMessage(userNumber, invalidMessage);
          logInteraction(userNumber, userInfo, invalidMessage, 'system_message');
        }
        break;

      case 'seu_dinheiro_submenu':
        if (normalizedBody === '1') {
          await chat.sendStateTyping();
          await delay(500);
          const seuDinheiroPath1 = path.join(
            __dirname,
            'seu_dinheiro',
            'seu_dinheiro_1.pdf'
          );
          const filename1 = 'seu_dinheiro_1.pdf';
          try {
            const media1 = MessageMedia.fromFilePath(seuDinheiroPath1);
            await client.sendMessage(userNumber, media1, {
              sendMediaAsDocument: true,
              filename: filename1,
            });
            logInteraction(userNumber, userInfo, filename1, 'file_sent');
            await delay(500);
            const optionsMessage = '\nDigite 0 para voltar ao menu principal ou "s" para sair.';
            await client.sendMessage(userNumber, optionsMessage);
            logInteraction(userNumber, userInfo, optionsMessage, 'system_message');
            stateManager.states[userNumber] = 'seu_dinheiro_submenu';
          } catch (error) {
            logInteraction(
              userNumber,
              userInfo,
              `Erro ao enviar ${filename1}: ${error?.message}`,
              'error'
            );
            await client.sendMessage(
              userNumber,
              `Erro ao enviar o arquivo Seu dinheiro 1. Verifique se o arquivo existe na pasta 'seu_dinheiro'.`
            );
            logInteraction(
              userNumber,
              userInfo,
              `Erro ao enviar o arquivo Seu dinheiro 1. Verifique se o arquivo existe na pasta 'seu_dinheiro'.`,
              'system_message'
            );
          }
        } else if (normalizedBody === '2') {
          await chat.sendStateTyping();
          await delay(500);
          const seuDinheiroPath2 = path.join(
            __dirname,
            'seu_dinheiro',
            'seu_dinheiro_2.pdf'
          );
          const filename2 = 'seu_dinheiro_2.pdf';
          try {
            const media2 = MessageMedia.fromFilePath(seuDinheiroPath2);
            await client.sendMessage(userNumber, media2, {
              sendMediaAsDocument: true,
              filename: filename2,
            });
            logInteraction(userNumber, userInfo, filename2, 'file_sent');
            await delay(500);
            const optionsMessage = '\nDigite 0 para voltar ao menu principal ou "s" para sair.';
            await client.sendMessage(userNumber, optionsMessage);
            logInteraction(userNumber, userInfo, optionsMessage, 'system_message');
            stateManager.states[userNumber] = 'seu_dinheiro_submenu';
          } catch (error) {
            logInteraction(
              userNumber,
              userInfo,
              `Erro ao enviar ${filename2}: ${error?.message}`,
              'error'
            );
            await client.sendMessage(
              userNumber,
              `Erro ao enviar o arquivo Seu dinheiro 2. Verifique se o arquivo existe na pasta 'seu_dinheiro'.`
            );
            logInteraction(
              userNumber,
              userInfo,
              `Erro ao enviar o arquivo Seu dinheiro 2. Verifique se o arquivo existe na pasta 'seu_dinheiro'.`,
              'system_message'
            );
          }
        } else if (normalizedBody === '0') {
          await handlers.sendMainMenu(userNumber, userInfo, false);
        } else if (normalizedBody === 's') {
          await handlers.resetConversation(userNumber);
        } else {
          await client.sendMessage(
            userNumber,
            'Opção inválida. Digite 1 ou 2 para as opções de "Seu dinheiro", 0 para voltar ou "s" para sair.'
          );
          logInteraction(
            userNumber,
            userInfo,
            'Opção inválida no submenu Seu dinheiro',
            'system_message'
          );
        }
        break;

      case 'boletos_menu':
      case 'contas_menu':
      case 'notificacoes_menu':
      case 'previsao_despesas_menu':
      case 'seu_dinheiro_menu':
      case 'historico_menu':
        if (normalizedBody === '0') {
          await handlers.sendMainMenu(userNumber, userInfo, false);
        } else if (normalizedBody === 's') {
          await handlers.resetConversation(userNumber);
        } else {
          await client.sendMessage(
            userNumber,
            'Opção inválida. Digite 0 para voltar ao menu inicial ou "s" para sair.'
          );
          logInteraction(
            userNumber,
            userInfo,
            'Opção inválida. Digite 0 para voltar ao menu inicial ou "s" para sair.',
            'system_message'
          );
        }
        break;

      case 'returning_to_main_menu':
        if (normalizedBody === '0') {
          await handlers.sendMainMenu(userNumber, userInfo, false);
        } else if (normalizedBody === 's') {
          await handlers.resetConversation(userNumber);
        } else {
          const invalidMessage =
            `Opção inválida: "${msg.body}". ` +
            'Escolha 1 para Boletos, 2 para Prestação de contas, 3 para Notificações, 4 para Previsão de despesas, 5 para Seu dinheiro, 6 para Histórico ou "s" para sair.';
          await client.sendMessage(userNumber, invalidMessage);
          logInteraction(userNumber, userInfo, invalidMessage, 'system_message');
          stateManager.states[userNumber] = 'returning_to_main_menu';
        }
        break;

      case 'contas_mes_selection':
        if (normalizedBody === '0') {
          await handlers.sendMainMenu(userNumber, userInfo, false);
          stateManager.states[userNumber] = 'main_menu';
        } else if (normalizedBody === 's') {
          await handlers.resetConversation(userNumber);
        } else {
          const mesSelecionado = parseInt(normalizedBody, 10);
          if (!isNaN(mesSelecionado)) {
            await handlers.handleContas(userNumber, chat, userInfo, mesSelecionado);
          } else {
            await client.sendMessage(
              userNumber,
              'Opção de mês inválida. Digite um número de 1 a 12 para o mês.'
            );
            logInteraction(
              userNumber,
              userInfo,
              'Opção de mês inválida. Digite um número de 1 a 12 para o mês.',
              'system_message'
            );
          }
        }
        break;

      case 'contas_navigation':
        if (normalizedBody === '0') {
          await handlers.handleContasMenu(userNumber, chat, userInfo);
        } else if (normalizedBody === 's') {
          await handlers.resetConversation(userNumber);
        } else {
          await client.sendMessage(
            userNumber,
            'Opção inválida. Digite 0 para voltar ao menu de meses ou "s" para sair.'
          );
          logInteraction(
            userNumber,
            userInfo,
            'Opção inválida. Digite 0 para voltar ao menu de meses ou "s" para sair.',
            'system_message'
          );
        }
        break;

      default:
        await client.sendMessage(userNumber, 'Digite "oi" ou "ola" para iniciar!');
        logInteraction(userNumber, userInfo, 'Digite "oi" ou "ola" para iniciar!', 'system_message');
    }

    if (stateManager.states[userNumber]) {
      handlers.setTimeout(userNumber);
    }
  });

  // Inicializa o cliente
  client.initialize();
}

// ======================================================================
// Subida do servidor e bootstrap geral
// ======================================================================
async function bootstrap() {
  // Sobe o HTTP primeiro (útil pro Render marcar como “up” rápido)
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });

  try {
    await connectMongo();     // garante conexão antes do RemoteAuth
    await createWhatsappClient();
  } catch (err) {
    console.error('Falha na inicialização:', err);
    // Mantém o servidor HTTP vivo para permitir ver o erro e corrigir env vars
  }
}

bootstrap();