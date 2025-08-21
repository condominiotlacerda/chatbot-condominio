const qrcode = require('qrcode-terminal');
const { Client, MessageMedia } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');

// Configurações
const CONFIG = {
    TIMEOUT: 180000,
    VALID_APARTMENTS: ['1', '101', '102', '201', '202', '301', '302', '401'],
    BOLETO_TYPES: ['condominio', 'acordo_m2d', 'hidro_eletr'],
    AUTHORIZED_USERS: {
        '558586282980': { name: 'João Paulo', apartment: '1' },
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

// Inicialização
const client = new Client();
const stateManager = {
    states: {},
    timeouts: {},
    lastMessageIds: {},
    logFiles: {}
};

// Utilitários
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalizeMessage = text => text?.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase();
const normalizePhoneNumber = number => number.split('@')[0];

// Função de Log
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
    fs.appendFileSync(logFilePath, logMessage + '\n', 'utf8');
}

// Função de Detecção automática da Data atual
function getFormattedDate() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
  }
  
// Função que cria o caminho para buscar os boletos e prestação de contas modelo
function manipularCaminhoModelos(nomeDoArquivo) {
    const modelosDir = path.join(__dirname, 'pdfs', 'modelos');
    const caminhoCompleto = path.join(modelosDir, nomeDoArquivo);
    console.log(`Caminho completo para modelos: ${caminhoCompleto}`);
  }
  
// Função que cria o caminho para acessar a agenda das datas de entrega dos boletos
function criarCaminhoDados(nomeDoArquivo) {
    const dadosDir = path.join(__dirname, 'dados');
    const caminhoCompleto = path.join(dadosDir, nomeDoArquivo);
    console.log(`Caminho completo para dados: ${caminhoCompleto}`);
  }

// Handlers
const handlers = {
    async resetConversation(userNumber) {
        clearTimeout(stateManager.timeouts[userNumber]);
        delete stateManager.states[userNumber];
        delete stateManager.timeouts[userNumber];
        delete stateManager.lastMessageIds[userNumber];
        const userInfo = CONFIG.AUTHORIZED_USERS[normalizePhoneNumber(userNumber)]; // Obtém userInfo para o log
        const exitMessage = 'Você saiu da conversa. Digite "oi" para iniciar novamente.';
        await client.sendMessage(userNumber, exitMessage);
        logInteraction(userNumber, userInfo, exitMessage, 'system_message'); // Log da mensagem de saída
        delete stateManager.logFiles[userNumber]; // Remove o caminho do log após registrá-lo
    },

    setTimeout(userNumber) {
        clearTimeout(stateManager.timeouts[userNumber]);
        stateManager.timeouts[userNumber] = setTimeout(async () => {
            const userInfo = CONFIG.AUTHORIZED_USERS[normalizePhoneNumber(userNumber)];
            const timeoutMessage = 'Fim de conversa por inatividade. Digite "oi" para iniciar novamente.';
            await client.sendMessage(userNumber, timeoutMessage);
            logInteraction(userNumber, userInfo, timeoutMessage, 'system_message');
            handlers.resetConversation(userNumber);
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
        
        if (isInitial) {
            try {
                const media = MessageMedia.fromFilePath(path.join(__dirname, 'imagens', 'lacerda_assistente.png'));
                await client.sendMessage(userNumber, media);
                logInteraction(userNumber, userInfo, 'Imagem lacerda_assistente.png enviada', 'file_sent');
            } catch (error) {
                logInteraction(userNumber, userInfo, `Erro ao enviar imagem: ${error.message}`, 'error');
                await client.sendMessage(userNumber, "Erro ao enviar imagem da Assistente Virtual.");
                logInteraction(userNumber, userInfo, 'Erro ao enviar imagem da Assistente Virtual', 'system_message');
            }

            const welcomeMessage = `Olá, ${userInfo.name}! Eu sou a Lacerda, assistente virtual do Condomínio T Lacerda.\n\n` +
                                  'Digite uma opção:\n1 - Boletos\n2 - Prestação de contas\n\nPara sair digite "sair" ou "s"';
            await client.sendMessage(userNumber, welcomeMessage);
            logInteraction(userNumber, userInfo, welcomeMessage, 'system_message');
        } else {
            const menuMessage = 'Digite uma opção:\n1 - Boletos\n2 - Prestação de contas\n\nPara sair digite "sair" ou "s"';
            await client.sendMessage(userNumber, menuMessage);
            logInteraction(userNumber, userInfo, menuMessage, 'system_message');
        }
    },

    async handleBoletos(userNumber, chat, userInfo) {
        const apartment = userInfo.apartment;

        await chat.sendStateTyping();
        await delay(500);
        const boletosMessage = `Enviando boletos do apartamento ${apartment} com vencimento em 10 de março de 2025:`;
        await client.sendMessage(userNumber, boletosMessage);
        logInteraction(userNumber, userInfo, boletosMessage, 'system_message');

        const boletosDir = path.join(__dirname, 'pdfs', 'boletos', '2025', '3.mar');
        const isGroundFloor = apartment === '1';
        
        try {
            const suffixes = isGroundFloor ? ['', 'a', 'b'] : [''];
            for (const suffix of suffixes) {
                for (const type of CONFIG.BOLETO_TYPES) {
                    const filename = `boleto_tx_${type}_apto_${apartment}${suffix}.pdf`;
                    const filePath = path.join(boletosDir, filename);
                    
                    try {
                        const media = MessageMedia.fromFilePath(filePath);
                        await client.sendMessage(userNumber, media, { 
                            sendMediaAsDocument: true, 
                            filename 
                        });
                        logInteraction(userNumber, userInfo, filename, 'file_sent');
                        await delay(500);
                    } catch (error) {
                        logInteraction(userNumber, userInfo, `Erro ao enviar ${filename}: ${error.message}`, 'error');
                        await client.sendMessage(userNumber, `Erro ao enviar ${filename}`);
                        logInteraction(userNumber, userInfo, `Erro ao enviar ${filename}`, 'system_message');
                    }
                }
            }
            const optionsMessage = '\nDigite 0 para voltar ao menu inicial ou "s" para sair.';
            await client.sendMessage(userNumber, optionsMessage);
            logInteraction(userNumber, userInfo, optionsMessage, 'system_message');
            stateManager.states[userNumber] = 'boletos_menu';
        } catch (error) {
            logInteraction(userNumber, userInfo, `Erro ao processar boletos: ${error.message}`, 'error');
            await client.sendMessage(userNumber, "Erro ao processar boletos.");
            logInteraction(userNumber, userInfo, 'Erro ao processar boletos', 'system_message');
        }
    },

    async handleContas(userNumber, chat, userInfo) {
        await chat.sendStateTyping();
        await delay(500);
        const contasMessage = 'Enviando prestação de contas referente a fevereiro de 2025:';
        await client.sendMessage(userNumber, contasMessage);
        logInteraction(userNumber, userInfo, contasMessage, 'system_message');

        const contasPath = path.join(__dirname, 'pdfs', 'contas', '2025', '2.fev', 'prestacao_contas.pdf');
        
        try {
            const media = MessageMedia.fromFilePath(contasPath);
            await client.sendMessage(userNumber, media, { 
                sendMediaAsDocument: true, 
                filename: 'prestacao_contas_fev_2025.pdf' 
            });
            logInteraction(userNumber, userInfo, 'prestacao_contas_fev_2025.pdf', 'file_sent');
            await delay(500);
            const optionsMessage = '\nDigite 0 para voltar ao menu inicial ou "s" para sair.';
            await client.sendMessage(userNumber, optionsMessage);
            logInteraction(userNumber, userInfo, optionsMessage, 'system_message');
            stateManager.states[userNumber] = 'contas_menu';
        } catch (error) {
            logInteraction(userNumber, userInfo, `Erro ao enviar prestação de contas: ${error.message}`, 'error');
            await client.sendMessage(userNumber, "Erro ao enviar o arquivo de prestação de contas.");
            logInteraction(userNumber, userInfo, 'Erro ao enviar o arquivo de prestação de contas', 'system_message');
        }
    }
};

// Configuração do cliente
client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('WhatsApp conectado!'));
client.initialize();

// Handler de mensagens
client.on('message', async msg => {
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

    if (stateManager.lastMessageIds[userNumber] === msg.id.id) return;
    stateManager.lastMessageIds[userNumber] = msg.id.id;

    if (['sair', 's'].includes(normalizedBody)) {
        await handlers.resetConversation(userNumber);
        return;
    }

    if (['oi', 'ola'].includes(normalizedBody)) {
        await handlers.sendMainMenu(userNumber, userInfo, true);
        return;
    }

    switch (stateManager.states[userNumber]) {
        case 'main_menu':
            if (normalizedBody === '1') {
                await handlers.handleBoletos(userNumber, chat, userInfo);
            } else if (normalizedBody === '2') {
                await handlers.handleContas(userNumber, chat, userInfo);
            } else {
                const invalidMessage = `Opção inválida: "${msg.body}". Escolha 1 para Boletos, 2 para Prestação de contas ou "s" para sair.`;
                await client.sendMessage(userNumber, invalidMessage);
                logInteraction(userNumber, userInfo, invalidMessage, 'system_message');
            }
            break;

        case 'boletos_menu':
        case 'contas_menu':
            if (normalizedBody === '0') {
                await handlers.sendMainMenu(userNumber, userInfo, false);
            } else if (normalizedBody === 's') {
                await handlers.resetConversation(userNumber);
            } else {
                await client.sendMessage(userNumber, 'Opção inválida. Digite 0 para voltar ao menu inicial ou "s" para sair.');
                logInteraction(userNumber, userInfo, 'Opção inválida. Digite 0 para voltar ao menu inicial ou "s" para sair.', 'system_message');
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