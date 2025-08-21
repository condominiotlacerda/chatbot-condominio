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
    // console.log(`Caminho completo para dados: ${caminhoCompleto}`);
    return caminhoCompleto;
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
            'Digite uma opção:\n1 - Boletos\n2 - Prestação de contas\n3 - Datas de entrega dos boletos\n\nPara sair digite "sair" ou "s"';
          await client.sendMessage(userNumber, welcomeMessage);
          logInteraction(userNumber, userInfo, welcomeMessage, 'system_message');
        } else {
          const menuMessage = 'Digite uma opção:\n1 - Boletos\n2 - Prestação de contas\n3 - Datas de entrega dos boletos\n\nPara sair digite "sair" ou "s"';
          await client.sendMessage(userNumber, menuMessage);
          logInteraction(userNumber, userInfo, menuMessage, 'system_message');
        }
      },

      // Correção aqui: use a sintaxe de método para funções assíncronas
      async handleBoletos(userNumber, chat, userInfo) {
        console.log("--- DEBUG: A FUNÇÃO HANDLEBOLETOS FOI CHAMADA ---");
        const apartment = userInfo.apartment;
    
        await chat.sendStateTyping();
        await delay(500);
    
        const vencimentosFilePath = criarCaminhoDados('vencimento_boletos.json');
        const vencimentosData = JSON.parse(fs.readFileSync(vencimentosFilePath, 'utf8'));
        const vencimentos2025 = vencimentosData['2025'];
    
        const agendaFilePath = criarCaminhoDados('agenda_boletos.json');
        const agendaData = JSON.parse(fs.readFileSync(agendaFilePath, 'utf8'));
        const agenda2025 = agendaData['2025'];
    
        const hoje = new Date();
        //const hoje = new Date('2025-04-11T10:00:00.000Z'); // Simula a data de 11 de abril de 2025 =============================================
        const anoAtual = hoje.getFullYear();
        const mesAtual = hoje.toLocaleString('default', { month: 'long' });
    
        const mesAtualIndex = Object.keys(vencimentos2025).indexOf(mesAtual);
    
        if (mesAtualIndex > 0) {
            const mesAnterior = Object.keys(vencimentos2025)[mesAtualIndex - 1];
            const dataVencimentoMesAnteriorStr = vencimentos2025[mesAnterior];
            const dataEntregaMesAnteriorStr = agenda2025[mesAnterior];
    
            const dataVencimentoMesAnterior = new Date(dataVencimentoMesAnteriorStr.split('/').reverse().join('-'));
            const dataEntregaMesAnterior = new Date(dataEntregaMesAnteriorStr.split('/').reverse().join('-'));
    
            console.log("Data Vencimento Mês Anterior (dataVencimentoMesAnterior):", dataVencimentoMesAnterior);
            console.log("Data Entrega Mês Anterior (dataEntregaMesAnterior):", dataEntregaMesAnterior);
            console.log("Hoje (hoje):", hoje);
    
            if (hoje >= dataEntregaMesAnterior && hoje < new Date(dataVencimentoMesAnterior.getTime() + 24 * 60 * 60 * 1000)) {
                // Lógica para enviar os boletos individuais
                const boletosMessage = `Enviando boletos do apartamento ${apartment} com vencimento em ${dataVencimentoMesAnteriorStr}:`;
                await client.sendMessage(userNumber, boletosMessage);
                logInteraction(userNumber, userInfo, boletosMessage, 'system_message');
    
                const boletosDir = path.join(__dirname, 'pdfs', 'boletos');
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
                } catch (error) {
                    logInteraction(userNumber, userInfo, `Erro ao processar boletos: ${error.message}`, 'error');
                    await client.sendMessage(userNumber, "Erro ao processar boletos.");
                    logInteraction(userNumber, userInfo, 'Erro ao processar boletos', 'system_message');
                }
            } else {
                const proximaEntrega = agenda2025[mesAtual];
                const mensagem = `Não há boletos para o período atual. Próxima entrega a partir de: ${proximaEntrega}`;
                await client.sendMessage(userNumber, mensagem);
                logInteraction(userNumber, userInfo, mensagem, 'system_message');
            }
        } else {
            // Lógica para o primeiro mês do ano (Janeiro)
            const proximaEntrega = agenda2025[mesAtual];
            const mensagem = `Não há boletos para o período atual. Próxima entrega a partir de: ${proximaEntrega}`;
            await client.sendMessage(userNumber, mensagem);
            logInteraction(userNumber, userInfo, mensagem, 'system_message');
        }
    
        const optionsMessage = '\nDigite 0 para voltar ao menu inicial ou "s" para sair.';
        await client.sendMessage(userNumber, optionsMessage);
        logInteraction(userNumber, userInfo, optionsMessage, 'system_message');
        stateManager.states[userNumber] = 'boletos_menu';
    },

    async handleContas(userNumber, chat, userInfo) {
        await chat.sendStateTyping();
        await delay(500);
    
        const hoje = new Date();
        //const hoje = new Date('2025-04-11T10:00:00.000Z'); // Simula a data de 11 de abril de 2025 =============================================
        const anoAtual = hoje.getFullYear();
        const mesAtual = hoje.getMonth(); // 0 = Janeiro, 1 = Fevereiro, ...
    
        // Determina o mês da prestação de contas (mês anterior)
        const mesPrestacaoContas = (mesAtual === 0) ? 11 : mesAtual - 1; // Se Janeiro, volta para Dezembro do ano anterior
        const anoPrestacaoContas = (mesAtual === 0) ? anoAtual - 1 : anoAtual;
    
        const nomeMeses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
        const nomeMesPrestacaoContas = nomeMeses[mesPrestacaoContas];
        const numeroMesPrestacaoContas = mesPrestacaoContas + 1;
        const mesPastaPrestacaoContas = String(numeroMesPrestacaoContas) + '.' + nomeMesPrestacaoContas.substring(0, 3);
        const mensagemPrestacaoContas = `Enviando prestação de contas referente a ${nomeMesPrestacaoContas} de ${anoPrestacaoContas}:`;
    
        await client.sendMessage(userNumber, mensagemPrestacaoContas);
        logInteraction(userNumber, userInfo, mensagemPrestacaoContas, 'system_message');
    
        const contasPath = path.join(__dirname, 'pdfs', 'contas', String(anoPrestacaoContas), mesPastaPrestacaoContas, 'prestacao_contas.pdf');
    
        try {
            const media = MessageMedia.fromFilePath(contasPath);
            await client.sendMessage(userNumber, media, {
                sendMediaAsDocument: true,
                filename: `prestacao_contas_${nomeMesPrestacaoContas}_${anoPrestacaoContas}.pdf`
            });
            logInteraction(userNumber, userInfo, `prestacao_contas_${nomeMesPrestacaoContas}_${anoPrestacaoContas}.pdf`, 'file_sent');
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
    },


// Exibe as datas de entrega dos boletos para o ano de 2025, lendo as informações do arquivo 'agenda_boletos.json' na pasta dados.
    async handleDatasBoletos(userNumber, userInfo) {
        try {
            const boletosFilePath = criarCaminhoDados('agenda_boletos.json');
            const boletosData = JSON.parse(fs.readFileSync(boletosFilePath, 'utf8'));
            // console.log("Conteúdo do arquivo:", boletosData); // Linha adicionada
            const datasBoletos2025 = boletosData['2025'];
  
            let message = "**Datas de entrega dos boletos em 2025:**\n\n"; // Adiciona quebra de linha inicial
                for (const mes in datasBoletos2025) {
                message += `${mes}: ${datasBoletos2025[mes]}\n`; // Adiciona espaço após os dois pontos
            }
  
        await client.sendMessage(userNumber, message);
            logInteraction(userNumber, userInfo, message, 'system_message');
  
            const optionsMessage = '\nDigite 0 para voltar ao menu inicial ou "s" para sair.';
        await client.sendMessage(userNumber, optionsMessage);
            logInteraction(userNumber, userInfo, optionsMessage, 'system_message');
            stateManager.states[userNumber] = 'datas_boletos_menu';
  
        } catch (error) {
            logInteraction(userNumber, userInfo, `Erro ao acessar datas dos boletos: ${error.message}`, 'error');
        await client.sendMessage(userNumber, "Erro ao acessar as datas de entrega dos boletos.");
            logInteraction(userNumber, userInfo, 'Erro ao acessar as datas de entrega dos boletos', 'system_message');
        }
    },

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
          } else if (normalizedBody === '3') {
            await handlers.handleDatasBoletos(userNumber, userInfo);
          } else {
            const invalidMessage = `Opção inválida: "${msg.body}". Escolha 1 para Boletos, 2 para Prestação de contas, 3 para Datas de entrega dos boletos ou "s" para sair.`;
            await client.sendMessage(userNumber, invalidMessage);
            logInteraction(userNumber, userInfo, invalidMessage, 'system_message');
          }
          break;
      
        case 'boletos_menu':
        case 'contas_menu':
        case 'datas_boletos_menu': // Adicione este caso
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