const { expect } = require('chai');
const { dedupeRecentNotifications } = require('../utils/recentActivity');

describe('Recent activity deduplication', () => {
  it('collapses fan-out copies of the same event across notification owners', () => {
    const copies = [
      {
        owner: 'admin-a',
        type: 'download',
        message: 'Alex downloaded report.pdf',
        relatedUser: 'alex',
        relatedFile: 'file-1',
        date: '2026-11-26T10:00:00.100Z'
      },
      {
        owner: 'admin-b',
        type: 'download',
        message: 'Alex downloaded report.pdf',
        relatedUser: 'alex',
        relatedFile: 'file-1',
        date: '2026-11-26T10:00:00.900Z'
      }
    ];

    expect(dedupeRecentNotifications(copies)).to.have.lengthOf(1);
    expect(dedupeRecentNotifications(copies)[0].owner).to.equal('admin-a');
  });

  it('keeps distinct events and applies the requested result limit', () => {
    const notifications = [
      { type: 'view', message: 'Viewed report', relatedUser: 'alex', relatedFile: 'file-1', date: '2026-11-26T10:00:00Z' },
      { type: 'view', message: 'Viewed report', relatedUser: 'alex', relatedFile: 'file-2', date: '2026-11-26T10:00:00Z' },
      { type: 'view', message: 'Viewed report', relatedUser: 'alex', relatedFile: 'file-1', date: '2026-11-26T10:01:00Z' }
    ];

    expect(dedupeRecentNotifications(notifications, 2)).to.have.lengthOf(2);
  });
});