const { expect } = require('chai');
const { buildAdminFileActivityPayloads } = require('../utils/fileAccessNotifications');

describe('buildAdminFileActivityPayloads', () => {
  it('creates admin notifications with actor and file details', () => {
    const actor = { _id: 'actor-1', fullname: 'Alice Johnson', email: 'alice@example.com' };
    const fileRecord = {
      _id: 'file-1',
      filename: 'quarterly.pdf',
      originalName: 'Quarterly Report.pdf',
      owner: 'owner-1'
    };
    const admins = [{ _id: 'admin-1' }, { _id: 'admin-2' }];

    const payloads = buildAdminFileActivityPayloads({
      actor,
      fileRecord,
      admins,
      action: 'download'
    });

    expect(payloads).to.have.length(2);
    expect(payloads[0]).to.include({
      owner: 'admin-1',
      relatedFile: 'file-1',
      relatedUser: 'actor-1',
      action: 'download'
    });
    expect(payloads[0].message).to.contain('Alice Johnson');
    expect(payloads[0].message).to.contain('Quarterly Report.pdf');
    expect(payloads[0].metadata).to.deep.include({
      actorName: 'Alice Johnson',
      fileName: 'Quarterly Report.pdf',
      action: 'download'
    });
  });
});
