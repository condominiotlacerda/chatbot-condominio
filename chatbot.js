// Importando as bibliotecas necessárias
const express = require('express');
const { createServer } = require('http');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs').promises;

// Define a porta do servidor
const PORT = process.env.PORT || 8000;

// Cria uma instância do servidor Express e do servidor HTTP
const app = express();
const httpServer = createServer(app);

app.use(express.json());

// Variáveis para armazenar a imagem do QR Code e o estado do cliente
let qrCodeBase64 = null;
let clientReady = false;

// Objeto para gerenciar o estado das conversas dos usuários
const stateManager = {
    states: {},
    timeouts: {},
    lastMessageIds: {},
    logFiles: {},
    setState: (userNumber, state) => {
        stateManager.states[userNumber] = state;
    },
    getState: (userNumber) => {
        return stateManager.states[userNumber];
    },
    clearState: (userNumber) => {
        delete stateManager.states[userNumber];
    },
    setTimeout: (userNumber) => {
        clearTimeout(stateManager.timeouts[userNumber]);
        stateManager.timeouts[userNumber] = setTimeout(async () => {
            const userInfo = CONFIG.AUTHORIZED_USERS[normalizePhoneNumber(userNumber)];
            const timeoutMessage = 'Fim de conversa por inatividade. Digite "oi" para iniciar novamente.';
            if (userInfo) {
                 await client.sendMessage(userNumber, timeoutMessage);
                 logInteraction(userNumber, userInfo, timeoutMessage, 'system_message');
            }
            stateManager.clearState(userNumber);
        }, CONFIG.TIMEOUT);
    },
};

// Funções de utilidade e configuração
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
        '558599339889': { name: 'Célia', apartment: '401' }
    }
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalizeMessage = text => text?.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase();
const normalizePhoneNumber = number => number.split('@')[0];

function logInteraction(userNumber, userInfo, message, type = 'user_message') {
    const timestamp = new Date().toISOString();
    let logFilePath = stateManager.logFiles[userNumber];

    if (!logFilePath) {
        const now = new Date();
        const safeName = userInfo.name.replace(/[^a-zA-Z0-9]/g, '_');
        const fileName = `${userNumber}_${safeName}_apto_${userInfo.apartment}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}.txt`;
        logFilePath = path.join(__dirname, 'logs', fileName);
        stateManager.logFiles[userNumber] = logFilePath;
    }

    let logMessage = '';
    switch (type) {
        case 'user_message':
            logMessage = `[${timestamp}] Usuário ${userInfo.name} (${userNumber}) digitou: "${message}"`;
            break;
        case 'file_sent':
            logMessage = `[${timestamp}] Arquivo enviado para ${userInfo.name} (${userNumber}): ${message}`;
            break;
        case 'system_message':
            logMessage = `[${timestamp}] Sistema para ${userInfo.name} (${userNumber}): ${message}`;
            break;
        case 'error':
            logMessage = `[${timestamp}] Erro para ${userInfo.name} (${userNumber}): ${message}`;
            break;
    }

    console.log(logMessage);
    // fs.appendFileSync(logFilePath, logMessage + '\n', 'utf8'); // Descomente para ativar o log em arquivo
}


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
            const timeoutMessage = 'Fim de conversa por inatividade. Digite "oi" para iniciar novamente.';
            if (userInfo) {
                 await client.sendMessage(userNumber, timeoutMessage);
                 logInteraction(userNumber, userInfo, timeoutMessage, 'system_message');
            }
            stateManager.clearState(userNumber);
        }, CONFIG.TIMEOUT);
    },

    async sendUnauthorizedMessage(userNumber) {
        await client.sendMessage(userNumber,
            `Este número (${userNumber}) não está autorizado. Por favor, entre em contato com o administrador da Assistente Virtual para cadastrar seu número.`
        );
    },

    async sendMainMenu(userNumber, userInfo, isInitial = true) {
        stateManager.states[userNumber] = 'main_menu';
        handlers.setTimeout(userNumber);

        const menuOptions = 'Digite uma opção:\n1 - Boletos\n2 - Prestação de contas\n3 - Notificações\n4 - Previsão de despesas\n5 - Seu dinheiro\n6 - Histórico\n\nPara sair digite "sair" ou "s"';

        if (isInitial) {
            
            try {
                // const media = MessageMedia.fromFilePath(path.join(__dirname, 'imagens', 'lacerda_assistente.png'));
                // await client.sendMessage(userNumber, media);
                // logInteraction(userNumber, userInfo, 'Imagem lacerda_assistente.png enviada', 'file_sent');
            } catch (error) {
                logInteraction(userNumber, userInfo, `Erro ao enviar imagem: ${error.message}`, 'error');
                await client.sendMessage(userNumber, "Erro ao enviar imagem da Assistente Virtual.");
                logInteraction(userNumber, userInfo, 'Erro ao enviar imagem da Assistente Virtual', 'system_message');
            }
            
            const welcomeMessage = `Olá, ${userInfo.name}! Eu sou a Lacerda, assistente virtual do Condomínio T Lacerda.\n\n` + menuOptions;
            await client.sendMessage(userNumber, welcomeMessage);
            logInteraction(userNumber, userInfo, welcomeMessage, 'system_message');
        } else {
            await client.sendMessage(userNumber, menuOptions);
            logInteraction(userNumber, userInfo, menuOptions, 'system_message');
        }
    },

    async handleBoletos(userNumber, chat, userInfo) {
        console.log("--- DEBUG: A FUNÇÃO HANDLEBOLETOS FOI CHAMADA ---");
        const apartment = userInfo.apartment;
        
        await chat.sendMessage('Aguarde...');
        
        const boletosFilePath = path.join(__dirname, 'dados', 'boletos_entrega.json');

        try {
            const boletosData = await fs.readFile(boletosFilePath, 'utf8');
            const boletosJson = JSON.parse(boletosData);

            const apartmentBoletos = boletosJson[`apto_${apartment}`];

            if (apartmentBoletos) {
                const boletosList = apartmentBoletos.split('\n').filter(b => b.startsWith('1.') || b.startsWith('2.') || b.startsWith('3.') || b.startsWith('4.'));

                if (boletosList.length > 0) {
                    await client.sendMessage(userNumber, `Enviando ${boletosList.length} boletos para o apartamento ${apartment}:`);
                    logInteraction(userNumber, userInfo, `Enviando ${boletosList.length} boletos para o apartamento ${apartment}:`, 'system_message');

                    for (let i = 0; i < boletosList.length; i++) {
                        const boletoInfo = boletosList[i];
                        const boletoNumber = boletoInfo.split('.')[0];
                        let boletoType = '';

                        if (boletoNumber === '1') {
                            boletoType = 'condominio';
                        } else if (boletoNumber === '2') {
                            boletoType = '1';
                        } else if (boletoNumber === '3') {
                            boletoType = '2';
                        } else if (boletoNumber === '4') {
                            boletoType = '3';
                        }

                        if (boletoType) {
                            const filename = `boleto_tx_${boletoType}_apto_${apartment}.pdf`;
                            const filePath = path.join(__dirname, 'pdfs', 'boletos', filename);

                            try {
                                await fs.access(filePath);
                                const media = MessageMedia.fromFilePath(filePath);
                                await client.sendMessage(userNumber, media, {
                                    sendMediaAsDocument: true,
                                    filename
                                });
                                logInteraction(userNumber, userInfo, filename, 'file_sent');
                                await delay(500);
                            } catch (error) {
                                logInteraction(userNumber, userInfo, `Erro ao enviar ${filename}: ${error.message}`, 'error');
                                await client.sendMessage(userNumber, `Erro ao enviar o boleto ${boletoInfo.split(' ')[1]}. Verifique se o arquivo ${filename} existe na pasta 'pdfs/boletos'.`);
                                logInteraction(userNumber, userInfo, `Erro ao enviar o boleto ${boletoInfo.split(' ')[1]}. Verifique se o arquivo ${filename} existe na pasta 'pdfs/boletos'.`, 'system_message');
                            }
                        }
                    }
                } else {
                    await client.sendMessage(userNumber, `Não há boletos disponíveis para o apartamento ${apartment} no momento.`);
                    logInteraction(userNumber, userInfo, `Não há boletos disponíveis para o apartamento ${apartment} no momento.`, 'system_message');
                }
            } else {
                await client.sendMessage(userNumber, `Não foram encontradas informações de boletos para o apartamento ${apartment}.`);
                logInteraction(userNumber, userInfo, `Não foram encontradas informações de boletos para o apartamento ${apartment}.`, 'system_message');
            }
            const optionsMessage = '\nDigite 0 para voltar ao menu inicial ou "s" para sair.';
            await client.sendMessage(userNumber, optionsMessage);
            logInteraction(userNumber, userInfo, optionsMessage, 'system_message');
            stateManager.states[userNumber] = 'boletos_menu';
        } catch (error) {
            console.error('Erro ao ler ou processar o arquivo de boletos:', error);
            await client.sendMessage(userNumber, 'Ocorreu um erro ao processar os boletos. Por favor, tente novamente mais tarde.');
            logInteraction(userNumber, userInfo, `Erro ao ler ou processar o arquivo de boletos: ${error.message}`, 'error');
            stateManager.states[userNumber] = 'main_menu';
        }
    },

    async handleContasMenu(userNumber, chat, userInfo) {
        stateManager.states[userNumber] = 'contas_mes_selection';
        handlers.setTimeout(userNumber);
        const meses = [
            'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
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
        await chat.sendMessage('Aguarde...');
        
        const anoAtual = new Date().getFullYear();
        const nomeMeses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
        
        if (mesSelecionado >= 1 && mesSelecionado <= 12) {
            const numeroMes = mesSelecionado.toString();
            const nomeMesPasta = nomeMeses[mesSelecionado - 1].substring(0, 3);
            const mesPastaCompleta = `${numeroMes}.${nomeMesPasta}`;
            const contasPath = path.join(__dirname, 'pdfs', 'contas', String(anoAtual), mesPastaCompleta, 'prestacao_contas.pdf');
            const nomeMesPorExtenso = nomeMeses[mesSelecionado - 1];
            const filename = `prestacao_contas_${nomeMesPorExtenso}_${anoAtual}.pdf`;
            
            try {
                await fs.access(contasPath);
                const media = MessageMedia.fromFilePath(contasPath);
                await client.sendMessage(userNumber, media, {
                    sendMediaAsDocument: true,
                    filename: filename
                });
                logInteraction(userNumber, userInfo, filename, 'file_sent');
                await delay(500);
                const optionsMessage = '\nDigite 0 para voltar ao menu de meses ou "s" para sair.';
                await client.sendMessage(userNumber, optionsMessage);
                logInteraction(userNumber, userInfo, optionsMessage, 'system_message');
                stateManager.states[userNumber] = 'contas_navigation';
            } catch (error) {
                logInteraction(userNumber, userInfo, `Erro ao enviar prestação de contas de ${nomeMesPorExtenso}: ${error.message}`, 'error');
                await client.sendMessage(userNumber, `Erro ao enviar a prestação de contas de ${nomeMesPorExtenso}. Verifique se o arquivo existe.`);
                logInteraction(userNumber, userInfo, `Erro ao enviar a prestação de contas de ${nomeMesPorExtenso}. Verifique se o arquivo existe.`, 'system_message');
                stateManager.states[userNumber] = 'contas_mes_selection';
            }
        } else {
            await client.sendMessage(userNumber, 'Opção de mês inválida. Digite um número de 1 a 12 para o mês.');
            logInteraction(userNumber, userInfo, 'Opção de mês inválida. Digite um número de 1 a 12 para o mês.', 'system_message');
        }
    },
};


// Inicializa o cliente do WhatsApp Web
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        // Argumentos para reduzir o consumo de recursos de memória e CPU
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--single-process',
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-skip-list',
            '--disable-audio-output',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-client-side-phishing-detection',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-features=interest-quiz',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-speech-api',
            '--disable-sync',
            '--disable-web-security',
            '--enable-features=NetworkService,NetworkServiceInProcess',
            '--enable-automation',
            '--force-device-scale-factor=1',
            '--font-render-hinting=none',
            '--force-color-profile=srgb'
        ],
    },
});

// Evento de QR Code gerado
client.on('qr', (qr) => {
    // Usa a biblioteca 'qrcode' para gerar uma imagem base64 do QR Code
    qrcode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error('Erro ao gerar QR Code como imagem:', err);
            qrCodeBase64 = null;
        } else {
            // Mensagem de log genérica para funcionar tanto localmente quanto em produção
            console.log('QR Code recebido. Por favor, acesse a página para escanear.');
            qrCodeBase64 = url; // Armazena a imagem em base64
        }
    });
});

// Evento de cliente pronto
client.on('ready', () => {
    console.log('Cliente está pronto!');
    clientReady = true;
});

// Evento de desconexão
client.on('disconnected', (reason) => {
    console.log('Cliente foi desconectado:', reason);
    clientReady = false;
});

// Rota principal que serve a página HTML com o QR code
app.get('/', (req, res) => {
    if (clientReady) {
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>WhatsApp Conectado</title>
                <style>
                    body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f0f2f5; color: #333; }
                    .container { text-align: center; background-color: white; padding: 2em; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
                    h1 { color: #008000; }
                    p { font-size: 1.1em; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Bot Conectado com Sucesso!</h1>
                    <p>O bot está pronto para receber mensagens.</p>
                </div>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Conectar Chatbot</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        background-color: #f0f2f5;
                        text-align: center;
                        color: #333;
                    }
                    .container {
                        background-color: #fff;
                        padding: 40px;
                        border-radius: 12px;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                    }
                    h1 {
                        color: #128C7E;
                    }
                    #qrcode-container img {
                        border: 4px solid #128C7E;
                        border-radius: 8px;
                        width: 250px;
                        height: 250px;
                    }
                    p {
                        margin-top: 20px;
                        font-size: 1.1em;
                    }
                    .message {
                        font-weight: bold;
                        margin-top: 10px;
                        color: #555;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Escaneie o QR Code</h1>
                    <p>Use o seu celular para escanear o c&oacute;digo abaixo e conectar o bot.</p>
                    <div id="qrcode-container">
                        <img id="qr-image" src="" alt="QR Code" style="display: none;">
                    </div>
                    <div class="message" id="status-message">Aguardando QR Code...</div>
                </div>
                <script>
                    const statusMessage = document.getElementById('status-message');
                    const qrImage = document.getElementById('qr-image');

                    async function fetchQrCode() {
                        try {
                            const response = await fetch('/status');
                            const data = await response.json();
                            if (data.qrCode) {
                                qrImage.src = data.qrCode;
                                qrImage.style.display = 'block';
                                statusMessage.textContent = 'QR Code recebido. Escaneie para conectar!';
                            } else {
                                qrImage.style.display = 'none';
                                statusMessage.textContent = 'Aguardando o QR Code...';
                                setTimeout(fetchQrCode, 2000);
                            }
                        } catch (error) {
                            console.error('Erro ao buscar QR Code:', error);
                            statusMessage.textContent = 'Erro ao carregar o QR Code.';
                            setTimeout(fetchQrCode, 5000);
                        }
                    }
                    fetchQrCode();
                </script>
            </body>
            </html>
        `);
    }
});

// Nova rota para servir o QR code em formato de imagem base64
app.get('/status', (req, res) => {
    res.json({
        qrCode: qrCodeBase64,
        clientReady: clientReady
    });
});

// Manipula todas as mensagens recebidas
client.on('message_create', async (message) => {
    const userNumber = normalizePhoneNumber(message.from);
    const body = message.body;
    const normalizedBody = body?.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const userInfo = CONFIG.AUTHORIZED_USERS[userNumber];

    if (!userInfo) {
        return handlers.sendUnauthorizedMessage(userNumber);
    }
    
    const chat = await message.getChat();

    if (normalizedBody === 's' || normalizedBody === 'sair') {
        handlers.resetConversation(userNumber);
        return;
    }

    stateManager.setTimeout(userNumber);
    
    const currentState = stateManager.getState(userNumber);

    switch (currentState) {
        case 'main_menu':
            if (normalizedBody === '1') {
                await handlers.handleBoletos(userNumber, chat, userInfo);
            } else if (normalizedBody === '2') {
                await handlers.handleContasMenu(userNumber, chat, userInfo);
            } else if (normalizedBody === '3' || normalizedBody === '4' || normalizedBody === '5' || normalizedBody === '6') {
                 await client.sendMessage(userNumber, 'Opção em desenvolvimento. Escolha 1 ou 2 por enquanto.');
                 logInteraction(userNumber, userInfo, 'Opção em desenvolvimento', 'system_message');
            } else {
                 await client.sendMessage(userNumber, 'Opção inválida. Digite um número de 1 a 6 para continuar ou "s" para sair.');
                 logInteraction(userNumber, userInfo, 'Opção inválida', 'system_message');
            }
            break;

        case 'boletos_menu':
            if (normalizedBody === '0') {
                await handlers.sendMainMenu(userNumber, userInfo, false);
            } else if (normalizedBody === 's') {
                await handlers.resetConversation(userNumber);
            } else {
                await client.sendMessage(userNumber, 'Opção inválida. Digite 0 para voltar ao menu inicial ou "s" para sair.');
                logInteraction(userNumber, userInfo, 'Opção inválida', 'system_message');
            }
            break;

        case 'contas_mes_selection':
            if (normalizedBody === '0') {
                await handlers.sendMainMenu(userNumber, userInfo, false);
            } else if (normalizedBody === 's') {
                await handlers.resetConversation(userNumber);
            } else {
                const mesSelecionado = parseInt(normalizedBody);
                if (!isNaN(mesSelecionado) && mesSelecionado >= 1 && mesSelecionado <= 12) {
                    await handlers.handleContas(userNumber, chat, userInfo, mesSelecionado);
                } else {
                    await client.sendMessage(userNumber, 'Opção de mês inválida. Digite um número de 1 a 12 para o mês.');
                    logInteraction(userNumber, userInfo, 'Opção de mês inválida. Digite um número de 1 a 12 para o mês.', 'system_message');
                }
            }
            break;

        case 'contas_navigation':
            if (normalizedBody === '0') {
                await handlers.handleContasMenu(userNumber, chat, userInfo);
            } else if (normalizedBody === 's') {
                await handlers.resetConversation(userNumber);
            } else {
                await client.sendMessage(userNumber, 'Opção inválida. Digite 0 para voltar ao menu de meses ou "s" para sair.');
                logInteraction(userNumber, userInfo, 'Opção inválida. Digite 0 para voltar ao menu de meses ou "s" para sair.', 'system_message');
            }
            break;

        default:
            if (normalizedBody === 'oi' || normalizedBody === 'ola') {
                await handlers.sendMainMenu(userNumber, userInfo);
            } else {
                await client.sendMessage(userNumber, 'Digite "oi" ou "ola" para iniciar!');
                logInteraction(userNumber, userInfo, 'Digite "oi" ou "ola" para iniciar!', 'system_message');
            }
            break;
    }
});


// Iniciando o servidor Express
httpServer.listen(PORT, () => {
    console.log(`O servidor Express está rodando na porta ${PORT}`);
    client.initialize();
});