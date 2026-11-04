import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { DoodleArrow, DoodleStar, ScribbleCircle, Squiggle, Tape } from "./doodles";

const tiles = [
  { label: "Session collections", value: "₹2,02,878", detail: "42.96% realised" },
  { label: "Admissions", value: "85", detail: "83 registered" },
  { label: "Students", value: "83", detail: "8 classes" },
] as const;

const quickJobs = ["New admission", "Record payment", "Enter results", "Create notice"] as const;

/** Billed vs collected per month, in thousands of rupees (illustrative). */
const months = [
  { month: "Jul", billed: 62, collected: 51 },
  { month: "Aug", billed: 48, collected: 41 },
  { month: "Sep", billed: 41, collected: 24 },
  { month: "Oct", billed: 56, collected: 43 },
  { month: "Nov", billed: 46, collected: 20 },
] as const;

function HeroHeading() {
  return (
    <h1 id="d3-hero-title" className="d3-hero-title">
      <span className="d3-highlight">Every dot</span> in your school,{" "}
      <span className="d3-nowrap"><span className="d3-circled">connected<ScribbleCircle /></span>.</span>
    </h1>
  );
}

function HeroActions() {
  return (
    <div className="d3-hero-actions">
      <Link to="/book-demo" className="d3-btn d3-btn-marker d3-btn-lg">
        Book a demo <ArrowRight aria-hidden="true" />
      </Link>
      <Link to="/login" className="d3-btn d3-btn-paper d3-btn-lg">Log in</Link>
    </div>
  );
}

function HeroCopy() {
  return (
    <div className="d3-hero-copy">
      <p className="d3-eyebrow d3-hand">
        <DoodleStar /> for schools across India · session 2026–27
      </p>
      <HeroHeading />
      <p className="d3-lede">
        Teachers, students, families, the office, accounts, the exam cell and the principal — all working
        from one place. CampusPilot does the repeated admin work <em>once</em>, and gets your school ready for AI.
      </p>
      <HeroActions />
      <p className="d3-hero-aside d3-hand">
        <DoodleArrow /> one login per person — everyone sees only what they should
      </p>
    </div>
  );
}

function SketchTitleBar() {
  return (
    <div className="d3-sk-bar">
      <span className="d3-sk-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="d3-hand">Riverview Public School · 2026–27</span>
    </div>
  );
}

function SketchTiles() {
  return (
    <ul className="d3-sk-tiles">
      {tiles.map((tile) => (
        <li key={tile.label} className="d3-sk-tile">
          <small>{tile.label}</small>
          <b>{tile.value}</b>
          <span className="d3-hand">{tile.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/** Pencil bar chart: billed bars are ink outlines, collected bars are orange hatching. */
function SketchChart() {
  return (
    <div className="d3-sk-chart">
      <p className="d3-sk-chart-title">Fee collection <span className="d3-hand">billed vs collected</span></p>
      <svg viewBox="0 0 300 120" aria-hidden="true">
        <g className="d3-pencil-art">
          <path className="d3-sk-axis" d="M14 100 C 90 101, 200 99, 292 100" />
          {months.map((entry, index) => {
            const x = 30 + index * 54;
            return (
              <g key={entry.month}>
                <rect className="d3-sk-billed" x={x} y={100 - entry.billed * 1.3} width="18" height={entry.billed * 1.3} />
                <rect className="d3-sk-collected" x={x + 20} y={100 - entry.collected * 1.3} width="18" height={entry.collected * 1.3} />
                <text x={x + 19} y="116" textAnchor="middle">{entry.month}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function SketchJobs() {
  return (
    <ul className="d3-sk-jobs" aria-label="Quick jobs">
      {quickJobs.map((job) => <li key={job}>+ {job}</li>)}
    </ul>
  );
}

function StickyApproval() {
  return (
    <div className="d3-sticky d3-hero-sticky">
      <Tape className="d3-tape-top" />
      <p className="d3-hand">Class 8–A report cards</p>
      <p className="d3-hand d3-sticky-strong">ready for your approval ✓</p>
    </div>
  );
}

function HeroSketch() {
  return (
    <figure className="d3-hero-sketch" aria-label="Illustrative sketch of a CampusPilot session dashboard">
      <div className="d3-sk-window">
        <Tape className="d3-tape-corner" />
        <SketchTitleBar />
        <div className="d3-sk-body">
          <p className="d3-sk-welcome">Welcome back, Mrs. Iyer</p>
          <SketchTiles />
          <SketchChart />
          <SketchJobs />
        </div>
      </div>
      <StickyApproval />
      <figcaption className="d3-hero-note d3-hand">
        live, the moment a receipt is issued
        <DoodleArrow />
      </figcaption>
    </figure>
  );
}

export function Hero() {
  return (
    <section className="d3-hero" aria-labelledby="d3-hero-title">
      <div className="d3-wrap d3-hero-grid">
        <HeroCopy />
        <HeroSketch />
      </div>
      <Squiggle className="d3-hero-rule" />
    </section>
  );
}
