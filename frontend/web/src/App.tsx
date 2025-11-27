import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface AssistantData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [assistants, setAssistants] = useState<AssistantData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingAssistant, setCreatingAssistant] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newAssistantData, setNewAssistantData] = useState({ name: "", value: "", description: "" });
  const [selectedAssistant, setSelectedAssistant] = useState<AssistantData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
        addOperation("FHEVM initialized successfully");
      } catch (error) {
        setTransactionStatus({ visible: true, status: "error", message: "FHEVM initialization failed" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const addOperation = (message: string) => {
    setOperationHistory(prev => [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev.slice(0, 9)]);
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const assistantsList: AssistantData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          assistantsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setAssistants(assistantsList);
      addOperation(`Loaded ${assistantsList.length} AI assistants`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "Service is available" });
        addOperation("Checked service availability");
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
    } finally {
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    }
  };

  const createAssistant = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingAssistant(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating AI assistant with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("No contract");
      
      const value = parseInt(newAssistantData.value) || 0;
      const businessId = `assistant-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, value);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAssistantData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newAssistantData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "AI assistant created!" });
      addOperation(`Created new AI assistant: ${newAssistantData.name}`);
      await loadData();
      setShowCreateModal(false);
      setNewAssistantData({ name: "", value: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected") 
        ? "Transaction rejected" 
        : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
    } finally { 
      setCreatingAssistant(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadData();
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted!" });
      addOperation(`Decrypted data for assistant: ${businessId}`);
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const filteredAssistants = assistants.filter(assistant => 
    assistant.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    assistant.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    total: assistants.length,
    verified: assistants.filter(a => a.isVerified).length,
    yourAssistants: assistants.filter(a => a.creator === address).length,
    avgValue: assistants.length > 0 
      ? assistants.reduce((sum, a) => sum + a.publicValue1, 0) / assistants.length 
      : 0
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Private AI Assistant 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <h2>Connect Your Wallet</h2>
            <p>Connect your wallet to access encrypted AI assistants</p>
            <div className="wallet-connect-center">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
        <p>Status: {fhevmInitializing ? "Initializing" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading AI Assistants...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private AI Assistant 🔐</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Assistant
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-cards">
          <div className="stat-card">
            <h3>Total Assistants</h3>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-card">
            <h3>Verified Data</h3>
            <div className="stat-value">{stats.verified}</div>
          </div>
          <div className="stat-card">
            <h3>Your Assistants</h3>
            <div className="stat-value">{stats.yourAssistants}</div>
          </div>
          <div className="stat-card">
            <h3>Avg Score</h3>
            <div className="stat-value">{stats.avgValue.toFixed(1)}</div>
          </div>
        </div>

        <div className="actions-bar">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search assistants..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="action-buttons">
            <button onClick={loadData} disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button onClick={checkAvailability}>
              Check Availability
            </button>
          </div>
        </div>

        <div className="assistants-grid">
          {filteredAssistants.length === 0 ? (
            <div className="no-assistants">
              <p>No AI assistants found</p>
              <button onClick={() => setShowCreateModal(true)}>
                Create First Assistant
              </button>
            </div>
          ) : filteredAssistants.map((assistant, index) => (
            <div 
              className={`assistant-card ${selectedAssistant?.id === assistant.id ? "selected" : ""}`}
              key={index}
              onClick={() => setSelectedAssistant(assistant)}
            >
              <div className="card-header">
                <h3>{assistant.name}</h3>
                {assistant.isVerified && <span className="verified-badge">Verified</span>}
              </div>
              <div className="card-body">
                <p>{assistant.description}</p>
                <div className="card-meta">
                  <span>Created: {new Date(assistant.timestamp * 1000).toLocaleDateString()}</span>
                  <span>Creator: {assistant.creator.substring(0, 6)}...{assistant.creator.substring(38)}</span>
                </div>
              </div>
              <div className="card-footer">
                <span>Score: {assistant.publicValue1}</span>
                {assistant.isVerified && assistant.decryptedValue && (
                  <span>Value: {assistant.decryptedValue}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="history-panel">
          <h3>Operation History</h3>
          <div className="history-list">
            {operationHistory.length === 0 ? (
              <p>No operations yet</p>
            ) : (
              operationHistory.map((op, idx) => (
                <div key={idx} className="history-item">
                  {op}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>New AI Assistant</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Assistant Name *</label>
                <input 
                  type="text" 
                  name="name" 
                  value={newAssistantData.name} 
                  onChange={(e) => setNewAssistantData({...newAssistantData, name: e.target.value})} 
                  placeholder="Enter name..." 
                />
              </div>
              
              <div className="form-group">
                <label>Encrypted Value (Integer) *</label>
                <input 
                  type="number" 
                  name="value" 
                  value={newAssistantData.value} 
                  onChange={(e) => setNewAssistantData({...newAssistantData, value: e.target.value.replace(/[^\d]/g, '')})} 
                  placeholder="Enter integer value..." 
                />
                <div className="hint">This value will be FHE encrypted</div>
              </div>
              
              <div className="form-group">
                <label>Description *</label>
                <textarea 
                  name="description" 
                  value={newAssistantData.description} 
                  onChange={(e) => setNewAssistantData({...newAssistantData, description: e.target.value})} 
                  placeholder="Enter description..." 
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button 
                onClick={createAssistant} 
                disabled={creatingAssistant || isEncrypting || !newAssistantData.name || !newAssistantData.value || !newAssistantData.description}
              >
                {creatingAssistant || isEncrypting ? "Creating..." : "Create Assistant"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedAssistant && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Assistant Details</h2>
              <button onClick={() => {
                setSelectedAssistant(null);
                setDecryptedValue(null);
              }} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-row">
                <span>Name:</span>
                <strong>{selectedAssistant.name}</strong>
              </div>
              <div className="detail-row">
                <span>Description:</span>
                <p>{selectedAssistant.description}</p>
              </div>
              <div className="detail-row">
                <span>Creator:</span>
                <strong>{selectedAssistant.creator.substring(0, 6)}...{selectedAssistant.creator.substring(38)}</strong>
              </div>
              <div className="detail-row">
                <span>Created:</span>
                <strong>{new Date(selectedAssistant.timestamp * 1000).toLocaleString()}</strong>
              </div>
              
              <div className="data-section">
                <h3>Encrypted Data</h3>
                <div className="data-row">
                  <span>Status:</span>
                  <strong>
                    {selectedAssistant.isVerified ? 
                      `Verified (Value: ${selectedAssistant.decryptedValue})` : 
                      decryptedValue !== null ? 
                      `Decrypted: ${decryptedValue}` : 
                      "🔒 Encrypted"
                    }
                  </strong>
                  <button 
                    onClick={async () => {
                      if (decryptedValue !== null) {
                        setDecryptedValue(null);
                      } else {
                        const value = await decryptData(selectedAssistant.id);
                        setDecryptedValue(value);
                      }
                    }}
                    disabled={isDecrypting || fheIsDecrypting}
                  >
                    {isDecrypting || fheIsDecrypting ? "Processing..." : 
                     selectedAssistant.isVerified ? "Verified" : 
                     decryptedValue !== null ? "Re-verify" : "Decrypt"}
                  </button>
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => {
                setSelectedAssistant(null);
                setDecryptedValue(null);
              }}>Close</button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && <div className="icon">✓</div>}
            {transactionStatus.status === "error" && <div className="icon">✗</div>}
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;