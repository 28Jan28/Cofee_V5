// Globální proměnné
let currentUser = null;
let coffeeOptions = [];

// Kontrola stavu serveru
async function checkServerStatus() {
    try {
        const response = await fetch('/api/v1/health');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        // Update status
        document.getElementById('serverStatus').textContent = 'Online';
        document.getElementById('mongoStatus').textContent = 
            data.services.mongodb.status === 'connected' ? 'Připojeno' : 'Odpojeno';
        document.getElementById('redisStatus').textContent = 
            data.services.redis.status === 'connected' ? 'Připojeno' : 'Odpojeno';
        
        const statusContainer = document.getElementById('statusContainer');
        statusContainer.innerHTML = `
            <div class="status online">
                Server je online (${new Date().toLocaleTimeString()})
                <br>
                MongoDB: ${data.services.mongodb.status}
                <br>
                Redis: ${data.services.redis.status}
            </div>
        `;
        
        // Load coffee options if server is online
        if (data.status === 'ok') {
            loadCoffeeOptions();
        }
    } catch (error) {
        console.error('Health check error:', error);
        showError('Server je nedostupný');
    }
}

// Načtení možností kávy
async function loadCoffeeOptions() {
    try {
        const response = await fetch('/api/v1/coffee-options');
        if (!response.ok) throw new Error('Failed to load coffee options');
        
        coffeeOptions = await response.json();
        renderCoffeeOptions();
    } catch (error) {
        console.error('Error loading coffee options:', error);
        showError('Nepodařilo se načíst nabídku kávy');
    }
}

// Zobrazení možností kávy
function renderCoffeeOptions() {
    const container = document.getElementById('coffeeOptions');
    container.innerHTML = '';
    
    coffeeOptions.forEach(option => {
        const div = document.createElement('div');
        div.className = 'coffee-option';
        div.innerHTML = `
            <h3>${option.name}</h3>
            <p>${option.price} Kč</p>
        `;
        
        if (currentUser && currentUser.credit >= option.price) {
            div.onclick = () => purchaseCoffee(option);
        } else {
            div.className += ' disabled';
        }
        
        container.appendChild(div);
    });
}

// Nákup kávy
async function purchaseCoffee(option) {
    if (!currentUser) {
        showError('Nejprve přiložte kartu');
        return;
    }
    
    if (currentUser.credit < option.price) {
        showError('Nedostatečný kredit');
        return;
    }
    
    try {
        const response = await fetch('/api/v1/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId: currentUser._id,
                type: 'purchase',
                amount: -option.price,
                item: option.name,
                terminalId: 'WEB-TERMINAL'
            })
        });
        
        if (!response.ok) throw new Error('Failed to process transaction');
        
        const transaction = await response.json();
        currentUser.credit = transaction.balance;
        updateUserInfo();
        showSuccess(`${option.name} se připravuje...`);
        
        // Simulace přípravy kávy
        setTimeout(() => {
            showSuccess('Káva je připravena! Dobrou chuť!');
        }, 3000);
    } catch (error) {
        console.error('Purchase error:', error);
        showError('Nepodařilo se zpracovat nákup');
    }
}

// Ověření RFID karty
async function verifyRFID(rfid) {
    try {
        const response = await fetch('/api/v1/verify-rfid', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                rfid: rfid,
                terminalId: 'WEB-TERMINAL'
            })
        });
        
        if (!response.ok) throw new Error('Invalid RFID');
        
        const data = await response.json();
        currentUser = data.user;
        updateUserInfo();
        document.getElementById('coffeeOptions').style.display = 'grid';
        renderCoffeeOptions();
        showSuccess('Karta ověřena');
    } catch (error) {
        console.error('RFID verification error:', error);
        showError('Neplatná karta');
        resetUserInfo();
    }
}

// Aktualizace informací o uživateli
function updateUserInfo() {
    const userInfo = document.getElementById('userInfo');
    if (currentUser) {
        document.getElementById('userName').textContent = currentUser.name;
        document.getElementById('userCredit').textContent = currentUser.credit;
        userInfo.style.display = 'block';
    } else {
        userInfo.style.display = 'none';
    }
}

// Reset informací o uživateli
function resetUserInfo() {
    currentUser = null;
    document.getElementById('userInfo').style.display = 'none';
    document.getElementById('coffeeOptions').style.display = 'none';
}

// Zobrazení chybové zprávy
function showError(message) {
    const rfidMessage = document.getElementById('rfidMessage');
    rfidMessage.innerHTML = `<div class="error-message">${message}</div>`;
    setTimeout(() => {
        rfidMessage.innerHTML = '';
    }, 3000);
}

// Zobrazení úspěšné zprávy
function showSuccess(message) {
    const rfidMessage = document.getElementById('rfidMessage');
    rfidMessage.innerHTML = `<div class="success-message">${message}</div>`;
    setTimeout(() => {
        rfidMessage.innerHTML = '';
    }, 3000);
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Kontroluj status každých 10 sekund
    checkServerStatus();
    setInterval(checkServerStatus, 10000);
    
    // RFID input handler
    const rfidInput = document.getElementById('rfidInput');
    rfidInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            const rfid = rfidInput.value.trim();
            if (rfid) {
                verifyRFID(rfid);
                rfidInput.value = '';
            }
        }
    });
    
    // Automatický focus na RFID input
    rfidInput.focus();
    document.addEventListener('click', () => rfidInput.focus());
});