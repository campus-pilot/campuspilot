import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bestLink, closestLinks, drawnOnPage, linkTexts, nearestFirst } from './screen-links';

const exams = [
  { text: 'Periodic Test 1 Exam plan generated Completed Completed Nov 14, 2026', href: '/school/s/sessions/x/exam/periodic-test-1' },
  { text: 'First Term Examination Exam plan generated Completed Completed Nov 14, 2026', href: '/school/s/sessions/x/exam/first-term-examination' },
  { text: 'Second Term Examination Exam plan generated Not started', href: '/school/s/sessions/x/exam/second-term-examination' },
  { text: 'Annual Examination Exam plan generated Not started', href: '/school/s/sessions/x/exam/annual-examination' },
];

describe('bestLink', () => {
  it('finds a card by the name written on it, whatever else the card says', () => {
    assert.equal(bestLink('Second Term Examination', exams)?.href, '/school/s/sessions/x/exam/second-term-examination');
    // "Exam" is on every card, so it does not stand in the way.
    assert.equal(bestLink('second term exam', exams)?.href, '/school/s/sessions/x/exam/second-term-examination');
    assert.equal(bestLink('second term', exams)?.href, '/school/s/sessions/x/exam/second-term-examination');
    assert.equal(bestLink('the annual examination', exams)?.href, '/school/s/sessions/x/exam/annual-examination');
    assert.equal(bestLink('annual examination', exams)?.href, '/school/s/sessions/x/exam/annual-examination');
  });

  it('ignores case and punctuation', () => {
    const classes = [{ text: 'Class 8-B', href: '/c/8b' }, { text: 'Class 8-A', href: '/c/8a' }];
    assert.equal(bestLink('class 8 b', classes)?.href, '/c/8b');
  });

  it('prefers the exact name, then the closer one: "Class 1" is not "Class 10"', () => {
    const classes = [{ text: 'Class 10', href: '/c/10' }, { text: 'Class 1', href: '/c/1' }];
    assert.equal(bestLink('Class 1', classes)?.href, '/c/1');
  });

  it('follows nothing when two places match equally, so the user can say which', () => {
    const students = [{ text: 'Arjun Patel', href: '/s/1' }, { text: 'Arjun Reddy', href: '/s/2' }];
    assert.equal(bestLink('Arjun', students), null);
    assert.equal(bestLink('Arjun Reddy', students)?.href, '/s/2');
  });

  it('asks which when the rows differ only in a word the request does not name', () => {
    const papers = [
      { text: 'Open English Oral for Nursery', href: '/p/nursery/english/oral' },
      { text: 'Open English Written for Nursery', href: '/p/nursery/english/written' },
      { text: 'Open English Oral for LKG', href: '/p/lkg/english/oral' },
    ];
    // "LKG" is shorter than "Nursery", but that is no reason to open LKG's paper.
    assert.equal(bestLink('English Oral', papers), null);
    assert.equal(bestLink('English Oral for Nursery', papers)?.href, '/p/nursery/english/oral');
    assert.equal(bestLink('Nursery English written', papers)?.href, '/p/nursery/english/written');
    assert.equal(bestLink('Open English Oral for LKG', papers)?.href, '/p/lkg/english/oral');
  });

  it('never lets a word the request does not name decide, however many words it has', () => {
    const papers = [
      { text: 'Open English Oral for Nursery', href: '/p/nursery' },
      { text: 'Open English Oral for Class 1', href: '/p/class-1' },
      { text: 'Open Science Oral for UKG', href: '/p/ukg/science' },
      { text: 'Open Science Oral for Class 1', href: '/p/class-1/science' },
    ];
    assert.equal(bestLink('English Oral', papers), null);
    assert.equal(bestLink('Science Oral', papers), null);
    assert.equal(bestLink('English Oral for Class 1', papers)?.href, '/p/class-1');
  });

  it('sees a tie behind a second link to the best place', () => {
    const students = [{ text: 'Arjun Patel', href: '/s/1' }, { text: 'Arjun Patel', href: '/s/1' }, { text: 'Arjun Reddy', href: '/s/2' }];
    assert.equal(bestLink('Arjun', students), null);
  });

  it('keeps the best of several links to one place: an exact breadcrumb beats a card with more on it', () => {
    const links = [
      { text: 'Arjun Patel Class 5 Roll 3', href: '/s/1' },
      { text: 'Arjun Patel', href: '/s/1' },
      { text: 'Arjun Patel Senior', href: '/s/3' },
    ];
    assert.equal(bestLink('Arjun Patel', links)?.href, '/s/1');
  });

  it('treats two links to the same place as one', () => {
    const same = [{ text: 'Aanya Menon', href: '/s/1' }, { text: 'Aanya Menon', href: '/s/1' }];
    assert.equal(bestLink('Aanya Menon', same)?.href, '/s/1');
  });

  it('follows nothing for a name that is not on the screen', () => {
    assert.equal(bestLink('Unit Test 3', exams), null);
    assert.equal(bestLink('', exams), null);
  });
});

describe('bestLink in a sidebar', () => {
  const sidebar = [
    { text: 'School', href: '/settings' },
    { text: 'Templates', href: '/settings/templates' },
    { text: 'Examination', href: '/settings/templates/exam' },
    { text: 'ID card', href: '/settings/templates/id-card' },
    { text: 'Admit card', href: '/settings/templates/admit-card' },
    { text: 'View', href: '/demo' },
  ];

  it('opens a short link the request names in more words', () => {
    assert.equal(bestLink('admit card templates', sidebar)?.href, '/settings/templates/admit-card');
    assert.equal(bestLink('the admit card templates page', sidebar)?.href, '/settings/templates/admit-card');
    assert.equal(bestLink('ID card template', sidebar)?.href, '/settings/templates/id-card');
  });

  it('never opens a one-word link only because a longer request contains its word', () => {
    assert.equal(bestLink('view the results of class 5', sidebar), null);
  });
});

describe('closestLinks', () => {
  it('lists the places that match equally well, once each, so the user can be asked which', () => {
    const papers = [
      { text: 'Open English Oral for Nursery', href: '/p/nursery' },
      { text: 'Open English Oral for Nursery', href: '/p/nursery' },
      { text: 'Open English Oral for LKG', href: '/p/lkg' },
      { text: 'Open English Written for LKG', href: '/p/lkg/written' },
    ];
    assert.deepEqual(closestLinks('English Oral', papers).map((link) => link.href), ['/p/nursery', '/p/lkg']);
  });

  it('is empty when one place wins or nothing matches', () => {
    assert.deepEqual(closestLinks('Arjun Reddy', [{ text: 'Arjun Patel', href: '/s/1' }, { text: 'Arjun Reddy', href: '/s/2' }]), []);
    assert.deepEqual(closestLinks('Unit Test 3', exams), []);
  });
});

describe('nearestFirst', () => {
  it('puts the links sharing most of the request first, so a near miss is not cut from the list', () => {
    const sidebar = Array.from({ length: 40 }, (_, index) => ({ text: `Section ${index}`, href: `/x/${index}` }));
    const papers = [{ text: 'Open English Oral for Nursery', href: '/p/nursery' }, { text: 'Open English Oral for Class 1', href: '/p/class-1' }];
    const label = 'English oral question paper for Class 1';
    // Five of its seven words: not enough to open, but the model must see it to call again with its exact text.
    assert.equal(bestLink(label, [...sidebar, ...papers]), null);
    const texts = linkTexts(nearestFirst(label, [...sidebar, ...papers]));
    assert.equal(texts[0], 'Open English Oral for Class 1');
    assert.equal(texts.length, 40);
  });
});

describe('linkTexts', () => {
  it('lists each link’s text once, tidied and capped', () => {
    assert.deepEqual(linkTexts([{ text: ' Billing ', href: '/a' }, { text: 'Billing', href: '/b' }, { text: '', href: '/c' }, { text: 'Staff', href: '/d' }]), ['Billing', 'Staff']);
    assert.equal(linkTexts(Array.from({ length: 60 }, (_, index) => ({ text: `Link ${index}`, href: `/${index}` }))).length, 40);
  });
});

describe('drawnOnPage', () => {
  it('counts what is drawn anywhere on the page, also far below the window, and nothing hidden or empty', () => {
    // A card three screens down: the assistant read it with the rest of the page, so it can be opened by name.
    assert.equal(drawnOnPage({ width: 320, height: 96 }, true), true);
    // A link inside a closed menu, and one with no box at all.
    assert.equal(drawnOnPage({ width: 320, height: 96 }, false), false);
    assert.equal(drawnOnPage({ width: 0, height: 0 }, true), false);
  });
});
