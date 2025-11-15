import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface AssistantData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface UsageStats {
  totalSessions: number;
  encryptedQueries: number;
  avgResponseTime: number;
  privacyScore: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [assistantData, setAssistantData] = useState<AssistantData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingData, setCreatingData] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newData, setNewData] = useState({ name: "", value: "", description: "" });
  const [selectedData, setSelectedData] = useState<AssistantData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const [stats, setStats] = useState<UsageStats>({
    totalSessions: 0,
    encryptedQueries: 0,
    avgResponseTime: 0,
    privacyScore: 100
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
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

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const dataList: AssistantData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          dataList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setAssistantData(dataList);
      updateStats(dataList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (data: AssistantData[]) => {
    setStats({
      totalSessions: data.length,
      encryptedQueries: data.filter(d => d.isVerified).length,
      avgResponseTime: data.length > 0 ? Math.round(data.reduce((sum, d) => sum + d.publicValue1, 0) / data.length) : 0,
      privacyScore: data.length > 0 ? Math.min(100, Math.round((data.filter(d => d.isVerified).length / data.length) * 100)) : 100
    });
  };

  const createData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingData(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting data with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const intValue = parseInt(newData.value) || 0;
      const businessId = `data-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, intValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Storing encrypted data..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data encrypted and stored!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewData({ name: "", value: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingData(false); 
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
        setDecryptedValue(storedValue);
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
      const numValue = Number(clearValue);
      setDecryptedValue(numValue);
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return numValue;
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvail = await contract.isAvailable();
      if (isAvail) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Service unavailable" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsPanel = () => {
    return (
      <div className="stats-panels">
        <div className="panel metal-panel">
          <div className="stat-icon">🔒</div>
          <h3>Encrypted Queries</h3>
          <div className="stat-value">{stats.encryptedQueries}</div>
        </div>
        
        <div className="panel metal-panel">
          <div className="stat-icon">⏱️</div>
          <h3>Avg Response</h3>
          <div className="stat-value">{stats.avgResponseTime}ms</div>
        </div>
        
        <div className="panel metal-panel">
          <div className="stat-icon">🛡️</div>
          <h3>Privacy Score</h3>
          <div className="stat-value">{stats.privacyScore}%</div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon glow">1</div>
          <div className="step-content">
            <h4>Input Encryption</h4>
            <p>User data encrypted with FHE 🔐</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon glow">2</div>
          <div className="step-content">
            <h4>AI Processing</h4>
            <p>Model inference on encrypted data</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon glow">3</div>
          <div className="step-content">
            <h4>Result Decryption</h4>
            <p>Only user can decrypt the response</p>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    return (
      <div className={`faq-section ${faqOpen ? 'open' : ''}`}>
        <div className="faq-header" onClick={() => setFaqOpen(!faqOpen)}>
          <h3>FHE Assistant FAQ</h3>
          <div className="faq-toggle">{faqOpen ? '▲' : '▼'}</div>
        </div>
        
        {faqOpen && (
          <div className="faq-content">
            <div className="faq-item">
              <h4>How does FHE protect my privacy?</h4>
              <p>FHE allows AI to process your data while it remains encrypted, ensuring no one can access your sensitive information.</p>
            </div>
            
            <div className="faq-item">
              <h4>What data types are supported?</h4>
              <p>Currently we support integer values for FHE operations. More data types coming soon.</p>
            </div>
            
            <div className="faq-item">
              <h4>How do I decrypt my data?</h4>
              <p>Click the "Decrypt" button on any data entry. This will verify the decryption proof on-chain.</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Private AI Assistant 🔐</h1>
            <p>FHE-Powered Confidential Computing</p>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon glow">🔐</div>
            <h2>Secure Your AI Experience</h2>
            <p>Connect your wallet to access the privacy-first AI assistant powered by Fully Homomorphic Encryption.</p>
            <div className="connection-steps">
              <div className="step">
                <span className="glow">1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span className="glow">2</span>
                <p>Encrypt your sensitive data on-chain</p>
              </div>
              <div className="step">
                <span className="glow">3</span>
                <p>Get AI insights without compromising privacy</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner glow"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your private AI experience</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner glow"></div>
      <p>Loading encrypted AI assistant...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private AI Assistant 🔐</h1>
          <p>FHE-Powered Confidential Computing</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn glow"
          >
            + New Encrypted Data
          </button>
          <button 
            onClick={checkAvailability} 
            className="status-btn glow"
          >
            Check FHE Status
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Privacy AI Analytics</h2>
          {renderStatsPanel()}
          
          <div className="panel metal-panel full-width">
            <h3>FHE 🔐 Confidential Computing Flow</h3>
            {renderFHEFlow()}
          </div>
          
          {renderFAQ()}
        </div>
        
        <div className="data-section">
          <div className="section-header">
            <h2>Encrypted Data Records</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn glow" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="data-list">
            {assistantData.length === 0 ? (
              <div className="no-data">
                <p>No encrypted data found</p>
                <button 
                  className="create-btn glow" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Data
                </button>
              </div>
            ) : assistantData.map((data, index) => (
              <div 
                className={`data-item ${selectedData?.id === data.id ? "selected" : ""} ${data.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => {
                  setSelectedData(data);
                  setDecryptedValue(null);
                }}
              >
                <div className="data-title">{data.name}</div>
                <div className="data-meta">
                  <span>Created: {new Date(data.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="data-status">
                  {data.isVerified ? (
                    <span className="verified-badge">✅ Verified</span>
                  ) : (
                    <span className="unverified-badge">🔒 Encrypted</span>
                  )}
                </div>
                <div className="data-creator">By: {data.creator.substring(0, 6)}...{data.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateData 
          onSubmit={createData} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingData} 
          data={newData} 
          setData={setNewData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedData && (
        <DataDetailModal 
          data={selectedData} 
          onClose={() => { 
            setSelectedData(null); 
            setDecryptedValue(null); 
          }} 
          decryptedValue={decryptedValue} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedData.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner glow"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateData: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  data: any;
  setData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, data, setData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'value') {
      const intValue = value.replace(/[^\d]/g, '');
      setData({ ...data, [name]: intValue });
    } else {
      setData({ ...data, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-data-modal">
        <div className="modal-header">
          <h2>New Encrypted Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Your data will be encrypted with Zama FHE before storage</p>
          </div>
          
          <div className="form-group">
            <label>Data Name *</label>
            <input 
              type="text" 
              name="name" 
              value={data.name} 
              onChange={handleChange} 
              placeholder="Enter data name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Integer Value *</label>
            <input 
              type="number" 
              name="value" 
              value={data.value} 
              onChange={handleChange} 
              placeholder="Enter integer value..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={data.description} 
              onChange={handleChange} 
              placeholder="Describe this data..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !data.name || !data.value} 
            className="submit-btn glow"
          >
            {creating || isEncrypting ? "Encrypting..." : "Encrypt & Store"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DataDetailModal: React.FC<{
  data: AssistantData;
  onClose: () => void;
  decryptedValue: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ data, onClose, decryptedValue, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) return;
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="data-detail-modal">
        <div className="modal-header">
          <h2>Encrypted Data Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="data-info">
            <div className="info-item">
              <span>Name:</span>
              <strong>{data.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{data.creator.substring(0, 6)}...{data.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(data.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Description:</span>
              <p>{data.description || "No description provided"}</p>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Value</h3>
            
            <div className="data-row">
              <div className="data-label">Encrypted Data:</div>
              <div className="data-value">
                {data.isVerified ? 
                  `Decrypted: ${data.decryptedValue}` : 
                  decryptedValue !== null ? 
                  `Decrypted: ${decryptedValue}` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              {!data.isVerified && (
                <button 
                  className={`decrypt-btn glow ${decryptedValue !== null ? 'decrypted' : ''}`}
                  onClick={handleDecrypt} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : "Decrypt"}
                </button>
              )}
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon glow">🔐</div>
              <div>
                <strong>FHE Confidential Computing</strong>
                <p>Your data remains encrypted during AI processing. Only you can decrypt the results.</p>
              </div>
            </div>
          </div>
          
          <div className="chart-section">
            <h3>Data Visualization</h3>
            <div className="chart-container">
              <div className="chart-bar">
                <div 
                  className="bar-fill" 
                  style={{ width: `${data.publicValue1 || 10}%` }}
                >
                  <span className="bar-value">{data.publicValue1 || 10}</span>
                </div>
              </div>
              <div className="chart-label">Data Confidence Level</div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!data.isVerified && decryptedValue !== null && (
            <button 
              className="verify-btn glow"
              disabled={isDecrypting}
            >
              Verify on-chain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

