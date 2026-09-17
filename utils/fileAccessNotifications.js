function buildAdminFileActivityPayloads({ actor, fileRecord, admins, action }) {
  if (!actor || !fileRecord || !Array.isArray(admins) || !admins.length) {
    return [];
  }

  const normalizedAction = action === 'download' ? 'download' : 'view';
  const actorName = actor.fullname || actor.email || 'A user';
  const fileName = fileRecord.originalName || fileRecord.filename || 'an uploaded file';
  const message = `${actorName} ${normalizedAction === 'download' ? 'downloaded' : 'viewed'} ${fileName}`;

  return admins.map((admin) => ({
    owner: admin._id,
    relatedFile: fileRecord._id,
    relatedUser: actor._id,
    action: normalizedAction,
    type: normalizedAction === 'download' ? 'download' : 'general',
    message,
    metadata: {
      actorName,
      actorEmail: actor.email || '',
      fileName,
      action: normalizedAction,
      fileId: fileRecord._id
    }
  }));
}

module.exports = {
  buildAdminFileActivityPayloads
};
