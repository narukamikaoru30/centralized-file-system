// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title FileRegistry
 * @dev Immutable file registry on Polygon Mainnet for proof of ownership and access control
 * Stores file hashes, ownership, permissions, and audit events
 */

contract FileRegistry {
    // Events
    event FileRegistered(
        bytes32 indexed fileHash,
        address indexed owner,
        string filename,
        uint256 timestamp
    );

    event OwnershipTransferred(
        bytes32 indexed fileHash,
        address indexed previousOwner,
        address indexed newOwner,
        uint256 timestamp
    );

    event PermissionGranted(
        bytes32 indexed fileHash,
        address indexed owner,
        address indexed user,
        uint8 permissionType,
        uint256 timestamp
    );

    event PermissionRevoked(
        bytes32 indexed fileHash,
        address indexed owner,
        address indexed user,
        uint256 timestamp
    );

    event AuditEventRecorded(
        bytes32 indexed fileHash,
        uint8 eventType,
        address indexed actor,
        string details,
        uint256 timestamp
    );

    // Permission Types (bit flags)
    uint8 public constant PERMISSION_READ = 0;
    uint8 public constant PERMISSION_WRITE = 1;
    uint8 public constant PERMISSION_TRANSFER = 2;
    uint8 public constant PERMISSION_DELETE = 3;
    uint8 public constant PERMISSION_SHARE = 4;

    // Audit Event Types
    uint8 public constant EVENT_UPLOAD = 0;
    uint8 public constant EVENT_DOWNLOAD = 1;
    uint8 public constant EVENT_SHARE = 2;
    uint8 public constant EVENT_DELETE = 3;
    uint8 public constant EVENT_LOGIN = 4;
    uint8 public constant EVENT_ROLE_CHANGE = 5;

    // File metadata structure
    struct FileMetadata {
        address owner;
        uint256 createdAt;
        uint256 fileSize;
        string filename;
        bool exists;
        mapping(address => uint256) permissions; // permissions bitmask per user
    }

    // Audit log entry structure
    struct AuditEntry {
        bytes32 fileHash;
        uint8 eventType;
        address actor;
        string details;
        uint256 timestamp;
    }

    // State variables
    mapping(bytes32 => FileMetadata) public files;
    AuditEntry[] public auditLog;
    mapping(bytes32 => uint256) public fileAuditCount; // Count of audit entries per file

    address public admin;
    bool public paused = false;

    // Modifiers
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this");
        _;
    }

    modifier onlyOwner(bytes32 _fileHash) {
        require(files[_fileHash].owner == msg.sender, "Only file owner can call this");
        _;
    }

    modifier _fileExists(bytes32 _fileHash) {
        require(files[_fileHash].exists, "File does not exist");
        _;
    }

    modifier notPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    // Constructor
    constructor() {
        admin = msg.sender;
    }

    /**
     * @dev Register a new file hash on the blockchain
     * @param _fileHash SHA-256 hash of the file
     * @param _owner Address of the file owner
     * @param _filename Name of the file
     * @param _fileSize Size of the file in bytes
     */
    function registerFileHash(
        bytes32 _fileHash,
        address _owner,
        string memory _filename,
        uint256 _fileSize
    ) external notPaused {
        require(!files[_fileHash].exists, "File already registered");
        require(_owner != address(0), "Invalid owner address");
        require(_fileHash != bytes32(0), "Invalid file hash");

        FileMetadata storage metadata = files[_fileHash];
        metadata.owner = _owner;
        metadata.createdAt = block.timestamp;
        metadata.fileSize = _fileSize;
        metadata.filename = _filename;
        metadata.exists = true;

        // Grant owner full permissions (all 5 permission types = 31 in bitmask)
        metadata.permissions[_owner] = 31;

        emit FileRegistered(_fileHash, _owner, _filename, block.timestamp);
    }

    /**
     * @dev Transfer file ownership to a new address
     * @param _fileHash Hash of the file
     * @param _newOwner Address of new owner
     */
    function transferOwnership(
        bytes32 _fileHash,
        address _newOwner
    ) external _fileExists(_fileHash) onlyOwner(_fileHash) notPaused {
        require(_newOwner != address(0), "Invalid new owner address");
        require(_newOwner != files[_fileHash].owner, "New owner is the same as current owner");

        address previousOwner = files[_fileHash].owner;
        files[_fileHash].owner = _newOwner;

        // Transfer all permissions to new owner
        files[_fileHash].permissions[_newOwner] = files[_fileHash].permissions[previousOwner];
        delete files[_fileHash].permissions[previousOwner];

        emit OwnershipTransferred(_fileHash, previousOwner, _newOwner, block.timestamp);
    }

    /**
     * @dev Grant permission to a user for a file
     * @param _fileHash Hash of the file
     * @param _user Address of the user
     * @param _permissionType Type of permission (0-4)
     */
    function grantPermission(
        bytes32 _fileHash,
        address _user,
        uint8 _permissionType
    ) external _fileExists(_fileHash) onlyOwner(_fileHash) notPaused {
        require(_user != address(0), "Invalid user address");
        require(_permissionType <= 4, "Invalid permission type");
        require(_user != files[_fileHash].owner, "Cannot grant permission to owner");

        // Set the bit for this permission
        files[_fileHash].permissions[_user] |= (1 << _permissionType);

        emit PermissionGranted(_fileHash, files[_fileHash].owner, _user, _permissionType, block.timestamp);
    }

    /**
     * @dev Revoke all permissions for a user on a file
     * @param _fileHash Hash of the file
     * @param _user Address of the user
     */
    function revokePermission(
        bytes32 _fileHash,
        address _user
    ) external _fileExists(_fileHash) onlyOwner(_fileHash) notPaused {
        require(_user != address(0), "Invalid user address");
        require(_user != files[_fileHash].owner, "Cannot revoke owner permissions");

        delete files[_fileHash].permissions[_user];

        emit PermissionRevoked(_fileHash, files[_fileHash].owner, _user, block.timestamp);
    }

    /**
     * @dev Check if a user has a specific permission on a file
     * @param _fileHash Hash of the file
     * @param _user Address of the user
     * @param _permissionType Type of permission (0-4)
     * @return True if user has the permission
     */
    function hasPermission(
        bytes32 _fileHash,
        address _user,
        uint8 _permissionType
    ) external view _fileExists(_fileHash) returns (bool) {
        // Owner always has all permissions
        if (files[_fileHash].owner == _user) {
            return true;
        }

        require(_permissionType <= 4, "Invalid permission type");
        uint256 permissions = files[_fileHash].permissions[_user];
        return (permissions & (1 << _permissionType)) != 0;
    }

    /**
     * @dev Record an audit event on the blockchain
     * @param _eventType Type of event (0-5)
     * @param _fileHash Hash of the file (can be 0 for non-file events like login)
     * @param _actor Address of the actor performing the action
     * @param _details Additional details about the event
     */
    function recordAuditEvent(
        uint8 _eventType,
        bytes32 _fileHash,
        address _actor,
        string memory _details
    ) external notPaused {
        require(_actor != address(0), "Invalid actor address");

        AuditEntry memory entry = AuditEntry({
            fileHash: _fileHash,
            eventType: _eventType,
            actor: _actor,
            details: _details,
            timestamp: block.timestamp
        });

        auditLog.push(entry);
        if (_fileHash != bytes32(0)) {
            fileAuditCount[_fileHash]++;
        }

        emit AuditEventRecorded(_fileHash, _eventType, _actor, _details, block.timestamp);
    }

    /**
     * @dev Get file metadata
     * @param _fileHash Hash of the file
     * @return owner Address of the file owner
     * @return createdAt Timestamp when file was registered
     * @return fileSize Size of the file
     * @return filename Name of the file
     */
    function getFileMetadata(bytes32 _fileHash)
        external
        view
        _fileExists(_fileHash)
        returns (
            address owner,
            uint256 createdAt,
            uint256 fileSize,
            string memory filename
        )
    {
        FileMetadata storage metadata = files[_fileHash];
        return (metadata.owner, metadata.createdAt, metadata.fileSize, metadata.filename);
    }

    /**
     * @dev Get audit log entries
     * @param _start Starting index
     * @param _count Number of entries to return
     * @return Array of audit entries
     */
    function getAuditLog(uint256 _start, uint256 _count)
        external
        view
        returns (AuditEntry[] memory)
    {
        require(_start < auditLog.length, "Start index out of bounds");
        uint256 end = _start + _count;
        if (end > auditLog.length) {
            end = auditLog.length;
        }

        AuditEntry[] memory result = new AuditEntry[](end - _start);
        for (uint256 i = _start; i < end; i++) {
            result[i - _start] = auditLog[i];
        }

        return result;
    }

    /**
     * @dev Get total audit log entries
     * @return Total number of audit entries
     */
    function getAuditLogCount() external view returns (uint256) {
        return auditLog.length;
    }

    /**
     * @dev Pause/unpause the contract (admin only)
     * @param _pause True to pause, false to unpause
     */
    function setPaused(bool _pause) external onlyAdmin {
        paused = _pause;
    }

    /**
     * @dev Transfer admin role to a new address
     * @param _newAdmin Address of new admin
     */
    function transferAdmin(address _newAdmin) external onlyAdmin {
        require(_newAdmin != address(0), "Invalid new admin address");
        admin = _newAdmin;
    }

    /**
     * @dev Check if a file is registered
     * @param _fileHash Hash of the file
     * @return True if file exists
     */
    function fileExists(bytes32 _fileHash) external view returns (bool) {
        return files[_fileHash].exists;
    }
}
