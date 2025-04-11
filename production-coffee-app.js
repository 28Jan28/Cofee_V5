// Frontend: CoffeeApp.js
import { useState, useEffect } from 'react';
import axios from 'axios'; // Pro API volání

export default function CoffeeApp() {
  // Základní stavy aplikace
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [adminUser, setAdminUser] = useState(null);
  const [rechargeAmount, setRechargeAmount] = useState(50);
  const [displayTab, setDisplayTab] = useState('users');
  const [coffeeOptions, setCoffeeOptions] = useState([]);
  const [newUser, setNewUser] = useState({ name: '', rfid: '', credit: 500 });
  const [rfidInput, setRfidInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [terminalId, setTerminalId] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [offlineTransactions, setOfflineTransactions] = useState([]);
  
  // Stavy pro potvrzení RFID
  const [confirmingUserSelection, setConfirmingUserSelection] = useState(false);
  const [userToConfirm, setUserToConfirm] = useState(null);
  const [adminVerificationMode, setAdminVerificationMode] = useState(false);
  const [adminAction, setAdminAction] = useState(null);

  // API Base URL
  const API_URL = process.env.REACT_APP_API_URL || 'https://api.coffee-system.example.com/v1';

  // Inicializace terminálu a kontrola online statusu
  useEffect(() => {
    // Získání nebo vytvoření ID terminálu
    const storedTerminalId = localStorage.getItem('terminalId');
    if (storedTerminalId) {
      setTerminalId(storedTerminalId);
    } else {
      const newTerminalId = `terminal-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      localStorage.setItem('terminalId', newTerminalId);
      setTerminalId(newTerminalId);
    }

    // Kontrola připojení k internetu a nastavení listenerů
    const updateOnlineStatus = () => {
      const online = navigator.onLine;
      setIsOffline(!online);
      
      // Pokud jsme právě přešli do online módu, odešleme offline transakce
      if (online) {
        syncOfflineTransactions();
      }
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  // Načtení dat při inicializaci
  useEffect(() => {
    if (!terminalId) return;
    
    const fetchInitialData = async () => {
      setIsLoading(true);
      try {
        // Paralelní načtení uživatelů a možností kávy
        const [usersResponse, coffeeResponse] = await Promise.all([
          axios.get(`${API_URL}/users`),
          axios.get(`${API_URL}/coffee-options`)
        ]);
        
        setUsers(usersResponse.data);
        setCoffeeOptions(coffeeResponse.data);
        
        // Kontrola a načtení případných offline transakcí
        const storedOfflineTransactions = localStorage.getItem('offlineTransactions');
        if (storedOfflineTransactions) {
          setOfflineTransactions(JSON.parse(storedOfflineTransactions));
        }
        
        setIsLoading(false);
      } catch (err) {
        console.error('Error fetching initial data:', err);
        setError('Nepodařilo se načíst data ze serveru. Používám offline data.');
        
        // Použijeme data z localStorage jako zálohu
        const cachedUsers = localStorage.getItem('cachedUsers');
        const cachedCoffeeOptions = localStorage.getItem('cachedCoffeeOptions');
        
        if (cachedUsers) setUsers(JSON.parse(cachedUsers));
        if (cachedCoffeeOptions) setCoffeeOptions(JSON.parse(cachedCoffeeOptions));
        
        setIsOffline(true);
        setIsLoading(false);
      }
    };
    
    fetchInitialData();
  }, [terminalId, API_URL]);

  // Ukládání dat do cache pro offline režim
  useEffect(() => {
    if (users.length > 0) {
      localStorage.setItem('cachedUsers', JSON.stringify(users));
    }
  }, [users]);

  useEffect(() => {
    if (coffeeOptions.length > 0) {
      localStorage.setItem('cachedCoffeeOptions', JSON.stringify(coffeeOptions));
    }
  }, [coffeeOptions]);

  // Ukládání offline transakcí
  useEffect(() => {
    if (offlineTransactions.length > 0) {
      localStorage.setItem('offlineTransactions', JSON.stringify(offlineTransactions));
    } else {
      localStorage.removeItem('offlineTransactions');
    }
  }, [offlineTransactions]);

  // Synchronizace offline transakcí při připojení k internetu
  const syncOfflineTransactions = async () => {
    if (offlineTransactions.length === 0 || isOffline) return;
    
    try {
      await axios.post(`${API_URL}/sync-transactions`, {
        terminalId,
        transactions: offlineTransactions
      });
      
      // Obnovení dat ze serveru po synchronizaci
      const usersResponse = await axios.get(`${API_URL}/users`);
      setUsers(usersResponse.data);
      
      // Vyprázdníme offline transakční frontu
      setOfflineTransactions([]);
      localStorage.removeItem('offlineTransactions');
    } catch (err) {
      console.error('Failed to sync offline transactions:', err);
    }
  };

  // Funkce pro přidání transakce - s podporou offline režimu
  const addTransaction = async (userId, transactionData) => {
    const transaction = {
      ...transactionData,
      userId,
      terminalId,
      timestamp: new Date().toISOString(),
      offlineId: `${terminalId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    };
    
    // V online režimu odešleme transakci přímo na server
    if (!isOffline) {
      try {
        const response = await axios.post(`${API_URL}/transactions`, transaction);
        return response.data;
      } catch (err) {
        console.error('Failed to create transaction, switching to offline mode:', err);
        setIsOffline(true);
        // Přidáme transakci do offline fronty
        setOfflineTransactions(prev => [...prev, transaction]);
        return transaction;
      }
    } else {
      // V offline režimu uložíme transakci do fronty
      setOfflineTransactions(prev => [...prev, transaction]);
      return transaction;
    }
  };

  // Simulace načtení RFID karty - produkční implementace
  const handleRfidSubmit = async () => {
    if (!rfidInput) return;
    
    if (isOffline) {
      // Offline režim používá lokální data
      const user = users.find(u => u.rfid === rfidInput);
      processRfidResult(user);
    } else {
      // Online režim ověřuje RFID přes API
      try {
        setIsLoading(true);
        const response = await axios.post(`${API_URL}/verify-rfid`, {
          rfid: rfidInput,
          terminalId
        });
        processRfidResult(response.data.user);
        setIsLoading(false);
      } catch (err) {
        console.error('Error verifying RFID:', err);
        setError('Nepodařilo se ověřit RFID kartu. Zkuste to znovu.');
        setIsLoading(false);
        
        // Přepneme do offline módu a zkusíme ověřit lokálně
        setIsOffline(true);
        const user = users.find(u => u.rfid === rfidInput);
        processRfidResult(user);
      }
    }
  };
  
  // Zpracování výsledku ověření RFID
  const processRfidResult = (user) => {
    // Pokud jsme v režimu potvrzení uživatele správy
    if (confirmingUserSelection && userToConfirm) {
      if (user && user.rfid === userToConfirm.rfid) {
        setSelectedUser(userToConfirm);
        setConfirmingUserSelection(false);
        setUserToConfirm(null);
        setRfidInput('');
      } else {
        alert('Neplatná RFID karta. Ověření se nezdařilo.');
        setConfirmingUserSelection(false);
        setUserToConfirm(null);
        setRfidInput('');
      }
      return;
    }
    
    // Pokud jsme v režimu ověření administrátora
    if (adminVerificationMode) {
      if (user && user.isAdmin) {
        setAdminUser(user);
        setAdminVerificationMode(false);
        setRfidInput('');
        
        // Proveď akci podle typu ověření
        if (adminAction === 'select_user' && userToConfirm) {
          setSelectedUser(userToConfirm);
          setUserToConfirm(null);
        }
      } else {
        alert('Neplatná administrátorská RFID karta. Nemáte oprávnění k této akci.');
        setAdminVerificationMode(false);
        setAdminAction(null);
        setUserToConfirm(null);
        setRfidInput('');
      }
      return;
    }
    
    // Běžné přihlášení uživatele
    if (user) {
      setSelectedUser(user);
      setRfidInput('');
    } else {
      alert('Neznámá RFID karta. Kontaktujte správce.');
      setRfidInput('');
    }
  };

  // Funkce pro dobití kreditu - produkční implementace
  const rechargeCredit = async () => {
    if (!selectedUser) return;
    
    const transactionData = {
      type: 'recharge',
      amount: rechargeAmount,
      date: new Date().toISOString(),
    };
    
    try {
      // Přidáme transakci (funkce sama řeší offline/online režim)
      await addTransaction(selectedUser.id, transactionData);
      
      // Aktualizujeme lokální stav uživatelů
      const updatedUsers = users.map(user => {
        if (user.id === selectedUser.id) {
          const updatedUser = {
            ...user,
            credit: user.credit + rechargeAmount,
            history: [
              ...user.history || [],
              { 
                ...transactionData,
                balance: user.credit + rechargeAmount
              }
            ]
          };
          return updatedUser;
        }
        return user;
      });
      
      setUsers(updatedUsers);
      setSelectedUser(updatedUsers.find(u => u.id === selectedUser.id));
    } catch (err) {
      console.error('Failed to recharge credit:', err);
      alert('Došlo k chybě při dobíjení kreditu. Zkuste to znovu později.');
    }
  };

  // Funkce pro výdej kávy - produkční implementace
  const dispenseCoffee = async (coffeeOption) => {
    if (!selectedUser) return;
    
    if (selectedUser.credit < coffeeOption.price) {
      alert('Nedostatečný kredit! Dobijte si prosím účet.');
      return;
    }
    
    const transactionData = {
      type: 'purchase',
      item: coffeeOption.name,
      amount: -coffeeOption.price,
      date: new Date().toISOString(),
    };
    
    try {
      // Přidáme transakci a zašleme příkaz k výdeji kávy
      await addTransaction(selectedUser.id, transactionData);
      
      if (!isOffline) {
        // V online režimu pošleme příkaz k výdeji kávy hardware zařízení
        await axios.post(`${API_URL}/dispense-coffee`, {
          terminalId,
          coffeeId: coffeeOption.id,
          userId: selectedUser.id
        });
      }
      
      // Aktualizujeme lokální stav uživatelů
      const updatedUsers = users.map(user => {
        if (user.id === selectedUser.id) {
          const updatedUser = {
            ...user,
            credit: user.credit - coffeeOption.price,
            history: [
              ...user.history || [],
              { 
                ...transactionData,
                balance: user.credit - coffeeOption.price
              }
            ]
          };
          return updatedUser;
        }
        return user;
      });
      
      setUsers(updatedUsers);
      setSelectedUser(updatedUsers.find(u => u.id === selectedUser.id));
      alert('Káva připravena! Dobrou chuť.');
    } catch (err) {
      console.error('Failed to dispense coffee:', err);
      alert('Došlo k chybě při výdeji kávy. Kontaktujte správce.');
    }
  };

  // Přidání nového uživatele - produkční implementace
  const addNewUser = async () => {
    if (!newUser.name || !newUser.rfid || !adminUser) return;
    
    try {
      setIsLoading(true);
      
      if (isOffline) {
        alert('Přidávání nových uživatelů není možné v offline režimu.');
        setIsLoading(false);
        return;
      }
      
      // Kontrola, zda RFID již neexistuje na serveru
      const response = await axios.post(`${API_URL}/check-rfid-availability`, {
        rfid: newUser.rfid
      });
      
      if (!response.data.available) {
        alert('Tato RFID karta je již přiřazena jinému uživateli.');
        setIsLoading(false);
        return;
      }
      
      // Vytvoření nového uživatele přes API
      const userResponse = await axios.post(`${API_URL}/users`, {
        name: newUser.name,
        rfid: newUser.rfid,
        credit: parseInt(newUser.credit) || 500,
        createdBy: adminUser.id,
        terminalId
      });
      
      // Přidání uživatele do lokálního stavu
      setUsers([...users, userResponse.data]);
      setNewUser({ name: '', rfid: '', credit: 500 });
      alert('Nový uživatel byl úspěšně přidán.');
      setIsLoading(false);
    } catch (err) {
      console.error('Failed to create user:', err);
      alert('Došlo k chybě při vytváření uživatele. Zkuste to znovu později.');
      setIsLoading(false);
    }
  };

  // Filtrování uživatelů podle vyhledávání
  const filteredUsers = users.filter(user => 
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    user.rfid.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Obsluha výběru uživatele v administraci
  const handleUserSelect = (user) => {
    setUserToConfirm(user);
    setConfirmingUserSelection(true);
  };

  // Obsluha přidání uživatele - vyžaduje admin přístup
  const initiateAddUser = () => {
    setAdminVerificationMode(true);
    setAdminAction('add_user');
  };

  // Odhlášení uživatele
  const logoutUser = () => {
    setSelectedUser(null);
  };

  // Odhlášení administrátora
  const logoutAdmin = () => {
    setAdminUser(null);
    setNewUser({ name: '', rfid: '', credit: 500 });
  };

  // Další kód pro zobrazení UI zůstává téměř stejný jako v původní verzi...
  // (jen přidáme indikátory offline režimu a načítání)

  return (
    <div className="p-4 max-w-4xl mx-auto bg-gray-100 rounded-lg shadow-lg" style={{ width: '1024px', height: '768px', overflow: 'auto' }}>
      <h1 className="text-3xl font-bold text-center mb-6">Kávovar RFID</h1>
      
      {/* Status indikátor */}
      {isOffline && (
        <div className="mb-4 p-2 bg-yellow-100 border border-yellow-400 text-yellow-800 rounded-lg text-center">
          Offline režim - data budou synchronizována při připojení k síti
          {offlineTransactions.length > 0 && (
            <div className="mt-1 text-sm">Čeká na synchronizaci: {offlineTransactions.length} transakcí</div>
          )}
        </div>
      )}
      
      {/* Chybová hláška */}
      {error && (
        <div className="mb-4 p-2 bg-red-100 border border-red-400 text-red-800 rounded-lg text-center">
          {error}
        </div>
      )}
      
      {/* Načítání */}
      {isLoading && (
        <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-50">
          <div className="text-xl font-semibold">Načítání...</div>
        </div>
      )}
      
      {/* Zbytek UI zůstává téměř totožný s původní verzí */}
      {/* ... */}
    </div>
  );
}
