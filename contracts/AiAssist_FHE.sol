pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AiAssist_FHE is ZamaEthereumConfig {
    
    struct EncryptedContext {
        euint32 encryptedData;
        uint256 contextId;
        address owner;
        uint256 timestamp;
        bool isProcessed;
    }
    
    struct InferenceResult {
        uint256 contextId;
        euint32 encryptedOutput;
        uint256 timestamp;
        bool isVerified;
    }
    
    mapping(uint256 => EncryptedContext) public encryptedContexts;
    mapping(uint256 => InferenceResult) public inferenceResults;
    
    uint256 public contextCounter;
    uint256 public resultCounter;
    
    event ContextEncrypted(uint256 indexed contextId, address indexed owner);
    event InferenceCompleted(uint256 indexed contextId, uint256 indexed resultId);
    event DecryptionVerified(uint256 indexed resultId, uint32 decryptedValue);
    
    constructor() ZamaEthereumConfig() {
        contextCounter = 0;
        resultCounter = 0;
    }
    
    function encryptContext(
        externalEuint32 encryptedData,
        bytes calldata inputProof
    ) external returns (uint256) {
        require(FHE.isInitialized(FHE.fromExternal(encryptedData, inputProof)), "Invalid encrypted input");
        
        uint256 contextId = contextCounter++;
        
        encryptedContexts[contextId] = EncryptedContext({
            encryptedData: FHE.fromExternal(encryptedData, inputProof),
            contextId: contextId,
            owner: msg.sender,
            timestamp: block.timestamp,
            isProcessed: false
        });
        
        FHE.allowThis(encryptedContexts[contextId].encryptedData);
        FHE.makePubliclyDecryptable(encryptedContexts[contextId].encryptedData);
        
        emit ContextEncrypted(contextId, msg.sender);
        return contextId;
    }
    
    function performInference(
        uint256 contextId,
        externalEuint32 encryptedOutput,
        bytes calldata outputProof
    ) external {
        require(contextId < contextCounter, "Invalid context ID");
        require(!encryptedContexts[contextId].isProcessed, "Context already processed");
        require(FHE.isInitialized(FHE.fromExternal(encryptedOutput, outputProof)), "Invalid encrypted output");
        
        uint256 resultId = resultCounter++;
        
        inferenceResults[resultId] = InferenceResult({
            contextId: contextId,
            encryptedOutput: FHE.fromExternal(encryptedOutput, outputProof),
            timestamp: block.timestamp,
            isVerified: false
        });
        
        FHE.allowThis(inferenceResults[resultId].encryptedOutput);
        FHE.makePubliclyDecryptable(inferenceResults[resultId].encryptedOutput);
        
        encryptedContexts[contextId].isProcessed = true;
        
        emit InferenceCompleted(contextId, resultId);
    }
    
    function verifyDecryption(
        uint256 resultId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(resultId < resultCounter, "Invalid result ID");
        require(!inferenceResults[resultId].isVerified, "Result already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(inferenceResults[resultId].encryptedOutput);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        inferenceResults[resultId].isVerified = true;
        
        emit DecryptionVerified(resultId, decodedValue);
    }
    
    function getEncryptedContext(uint256 contextId) external view returns (
        euint32 encryptedData,
        address owner,
        uint256 timestamp,
        bool isProcessed
    ) {
        require(contextId < contextCounter, "Invalid context ID");
        EncryptedContext storage ctx = encryptedContexts[contextId];
        return (ctx.encryptedData, ctx.owner, ctx.timestamp, ctx.isProcessed);
    }
    
    function getInferenceResult(uint256 resultId) external view returns (
        uint256 contextId,
        euint32 encryptedOutput,
        uint256 timestamp,
        bool isVerified
    ) {
        require(resultId < resultCounter, "Invalid result ID");
        InferenceResult storage res = inferenceResults[resultId];
        return (res.contextId, res.encryptedOutput, res.timestamp, res.isVerified);
    }
    
    function getContextCount() external view returns (uint256) {
        return contextCounter;
    }
    
    function getResultCount() external view returns (uint256) {
        return resultCounter;
    }
}

