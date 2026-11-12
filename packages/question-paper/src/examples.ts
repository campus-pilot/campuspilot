/**
 * Two complete worked examples of the fragment a model writes (design
 * html-design.md). They are the example in the learn guide, the sample body of
 * template previews and marketplace thumbnails, and version 1 of the demo
 * school's papers, so they must always pass the sanitiser and KaTeX without
 * findings (tested in the API package).
 *
 * Both follow the same house style, which the guide recommends: one `<style>`
 * block of short class rules, a `div.q` row per question with the number on the
 * left, the body in the middle and the marks on the right.
 */

const HOUSE_STYLE = `<style>
.sec{text-align:center;font-size:12pt;margin:4mm 0 1mm;break-after:avoid}
.note{margin:0 0 2mm;font-style:italic}
.q{display:flex;gap:2.5mm;margin:0 0 2.5mm;break-inside:avoid}
.q .no{font-weight:600;min-width:6mm}
.q .main{flex:1;min-width:0}
.q .marks{font-weight:600;white-space:nowrap}
.sub{display:flex;gap:2.5mm;margin:1.5mm 0 0}
.sub .main{flex:1}
.opts{display:grid;grid-template-columns:1fr 1fr;gap:1mm 6mm;margin-top:1mm}
.or{text-align:center;font-weight:600;margin:2mm 0}
</style>`;

/** Hindi mathematics, Class 9: MCQ with maths, a matrix, an OR choice, a table and a figure. Maximum marks 15. */
export const EXAMPLE_HINDI_MATH_HTML = `${HOUSE_STYLE}
<div lang="hi">
<ul class="note">
  <li>सभी प्रश्न अनिवार्य हैं।</li>
  <li>प्रश्नों के अंक उनके सामने दिए गए हैं।</li>
</ul>
<h2 class="sec">खंड अ</h2>
<p class="note">प्रत्येक प्रश्न 1 अंक का है। सही विकल्प चुनिए।</p>
<div class="q"><span class="no">1</span><div class="main">समीकरण <span data-math="2x+3=11"></span> का हल है:
  <div class="opts"><span>(क) <span data-math="x=2"></span></span><span>(ख) <span data-math="x=4"></span></span><span>(ग) <span data-math="x=7"></span></span><span>(घ) <span data-math="x=14"></span></span></div>
</div><span class="marks">[1]</span></div>
<div class="q"><span class="no">2</span><div class="main">भुजा 6 सेमी वाले वर्ग का क्षेत्रफल (वर्ग सेमी में) है:
  <div class="opts"><span>(क) 12</span><span>(ख) 24</span><span>(ग) 36</span><span>(घ) 72</span></div>
</div><span class="marks">[1]</span></div>
<h2 class="sec">खंड ब</h2>
<div class="q"><span class="no">3</span><div class="main">हल कीजिए: <span data-math="\\frac{x}{3}+\\sqrt{16}=7"></span></div><span class="marks">[2]</span></div>
<div class="q"><span class="no">4</span><div class="main">आव्यूह <span data-math="A=\\begin{bmatrix}1&amp;2\\\\3&amp;4\\end{bmatrix}"></span> के लिए:
  <div class="sub"><span>(क)</span><div class="main">आव्यूह <span data-math="A"></span> की कोटि लिखिए।</div><span class="marks">[1]</span></div>
  <div class="sub"><span>(ख)</span><div class="main"><span data-math="|A|"></span> का मान ज्ञात कीजिए।</div><span class="marks">[2]</span></div>
</div><span class="marks">[3]</span></div>
<h2 class="sec">खंड स</h2>
<p class="note">प्रत्येक प्रश्न 4 अंक का है।</p>
<div class="q"><span class="no">5</span><div class="main">द्विघात समीकरण <span data-math="x^2-5x+6=0"></span> को गुणनखंड विधि से हल कीजिए।
  <div class="or">अथवा</div>
  सूत्र <span data-math="x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}"></span> से समीकरण <span data-math="2x^2-7x+3=0"></span> के मूल ज्ञात कीजिए।
</div><span class="marks">[4]</span></div>
<div class="q"><span class="no">6</span><div class="main">नीचे दी गई सारणी का माध्य ज्ञात कीजिए:
  <table><tr><th>अंक</th><td>10</td><td>20</td><td>30</td></tr><tr><th>विद्यार्थी</th><td>5</td><td>8</td><td>7</td></tr></table>
</div><span class="marks">[4]</span></div>
</div>`;

/** English science, Class 8: MCQ, a fill in the blank, a table, sub-parts, an OR choice, an SVG drawing and a figure placeholder. Maximum marks 20. */
export const EXAMPLE_ENGLISH_SCIENCE_HTML = `${HOUSE_STYLE}
<div lang="en">
<ul class="note">
  <li>All questions are compulsory.</li>
  <li>Draw neat, labelled diagrams wherever required.</li>
</ul>
<h2 class="sec">Section A: Multiple choice</h2>
<p class="note">Each question carries 1 mark.</p>
<div class="q"><span class="no">1</span><div class="main">Which gas is released during photosynthesis?
  <div class="opts"><span>(a) Carbon dioxide</span><span>(b) Oxygen</span><span>(c) Nitrogen</span><span>(d) Hydrogen</span></div>
</div><span class="marks">[1]</span></div>
<div class="q"><span class="no">2</span><div class="main">The chemical formula of water is <span data-math="\\mathrm{H_2O}"></span>. It contains:
  <div class="opts"><span>(a) 2 atoms of hydrogen</span><span>(b) 2 atoms of oxygen</span><span>(c) 1 atom of hydrogen</span><span>(d) 3 atoms of oxygen</span></div>
</div><span class="marks">[1]</span></div>
<h2 class="sec">Section B: Short answer</h2>
<p class="note">Each question carries 2 marks.</p>
<div class="q"><span class="no">3</span><div class="main">The process of conversion of water vapour into liquid water is called ________.</div><span class="marks">[2]</span></div>
<div class="q"><span class="no">4</span><div class="main">Complete the table of states of matter.
  <table><tr><th>Substance</th><th>State at room temperature</th></tr><tr><td>Iron</td><td>Solid</td></tr><tr><td>Mercury</td><td>________</td></tr></table>
</div><span class="marks">[2]</span></div>
<h2 class="sec">Section C: Long answer</h2>
<div class="q"><span class="no">5</span><div class="main">Answer the following about the human digestive system.
  <div class="sub"><span>(a)</span><div class="main">Name the organ where most digestion is completed.</div><span class="marks">[2]</span></div>
  <div class="sub"><span>(b)</span><div class="main">Describe the role of the liver and the pancreas in digestion.</div><span class="marks">[4]</span></div>
</div><span class="marks">[6]</span></div>
<div class="q"><span class="no">6</span><div class="main">State two differences between a plant cell and an animal cell.
  <div class="or">OR</div>
  Explain why mitochondria are called the powerhouse of the cell.
</div><span class="marks">[4]</span></div>
<div class="q"><span class="no">7</span><div class="main">Name the parts marked A and B in the figure.
  <figure style="text-align:center;margin:2mm 0"><svg viewBox="0 0 140 70" width="280" height="140" role="img" aria-label="A horizontal line with two marked points A and B"><line x1="10" y1="40" x2="130" y2="40" stroke="#000" stroke-width="1.5"/><circle cx="40" cy="40" r="3" fill="#000"/><circle cx="100" cy="40" r="3" fill="#000"/><text x="36" y="30" font-size="10">A</text><text x="96" y="30" font-size="10">B</text></svg></figure>
  <figure data-placeholder="Hand-drawn labelled diagram of the human heart showing four chambers, aorta and vena cava"></figure>
</div><span class="marks">[4]</span></div>
</div>`;

export const QUESTION_PAPER_EXAMPLES = {
  'hindi-maths': EXAMPLE_HINDI_MATH_HTML,
  'english-science': EXAMPLE_ENGLISH_SCIENCE_HTML,
} as const;
