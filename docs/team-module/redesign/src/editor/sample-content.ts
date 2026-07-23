import type { BlockData, BlockType, QuestionData, QuestionKind } from '../types'
import { uid } from './uid'

/**
 * Demo content used by the simulated "Generate with AI" flow, themed to the
 * "States of Matter" lesson shown in the sidebar.
 */
/** Per-kind question content so generating keeps the block's question type. */
function sampleQuestionData(qKind: QuestionKind): QuestionData {
  const base: QuestionData = {
    block: 'question',
    qKind,
    prompt: '',
    points: 2,
    options: [],
    explanation: '',
    answer: '',
    criteria: [],
  }
  switch (qKind) {
    case 'multiple-choice':
      return {
        ...base,
        prompt: 'Which phase change releases energy to the surroundings?',
        options: [
          { id: uid('op'), text: 'Melting', correct: false },
          { id: uid('op'), text: 'Evaporation', correct: false },
          { id: uid('op'), text: 'Condensation', correct: true },
          { id: uid('op'), text: 'Sublimation', correct: false },
        ],
        explanation: 'Condensation releases the energy absorbed during evaporation back into the surroundings.',
      }
    case 'fill-blank':
      return {
        ...base,
        prompt: 'At standard pressure, water boils at ____ °C.',
        answer: '100, one hundred',
        explanation: 'The boiling point of water at 1 atm is 100 °C.',
      }
    case 'short-answer':
      return {
        ...base,
        prompt: 'In one sentence, explain why sweating cools the body.',
        answer: 'evaporation, evaporative cooling, evaporates',
        explanation: 'Sweat evaporating from the skin absorbs body heat as latent heat of vaporization.',
      }
    case 'open-ended':
      return {
        ...base,
        prompt: 'Explain, at the particle level, what happens as ice melts into liquid water.',
        points: 5,
        criteria: [
          { id: uid('cr'), text: 'Describes increased particle vibration with added energy', weight: 40, locked: false },
          { id: uid('cr'), text: 'Explains particles breaking out of the fixed lattice', weight: 40, locked: false },
          { id: uid('cr'), text: 'Uses correct scientific vocabulary', weight: 20, locked: false },
        ],
      }
  }
}

export function sampleBlockData(type: BlockType, qKind?: QuestionKind): BlockData {
  switch (type) {
    case 'header':
      return {
        block: 'header',
        text: 'Phase Transitions of Matter',
        learningObjective:
          'Students will be able to describe how matter changes between solid, liquid, and gas phases.',
      }
    case 'card':
      return {
        block: 'card',
        cards: [
          {
            id: uid('cd'),
            title: 'Solid',
            description: 'Particles are tightly packed in a fixed, ordered arrangement and only vibrate in place.',
            imageUrl: null,
            caption: '',
            imageFailed: false,
            generating: false,
          },
          {
            id: uid('cd'),
            title: 'Liquid',
            description: 'Particles stay close together but slide past one another, letting the substance flow.',
            imageUrl: null,
            caption: '',
            imageFailed: false,
            generating: false,
          },
          {
            id: uid('cd'),
            title: 'Gas',
            description: 'Particles move freely and spread out to fill the entire volume of their container.',
            imageUrl: null,
            caption: '',
            imageFailed: false,
            generating: false,
          },
        ],
      }
    case 'image':
      return {
        block: 'image',
        url: 'sample',
        caption: 'Water shown in all three common phases: ice, liquid water, and vapor.',
        altText: 'Diagram of water as ice cubes, liquid in a glass, and rising vapor',
        source: 'generate',
        failed: false,
      }
    case 'video':
      return {
        block: 'video',
        url: 'https://www.youtube.com/embed/tuE1Jm8sqYs',
        caption: 'States of matter explained with particle animations.',
        loadFailed: false,
      }
    case 'audio':
      return {
        block: 'audio',
        url: 'sample',
        title: 'Lecture 3 — Phase Changes',
        description: 'A short recap of melting, freezing, evaporation, and condensation.',
        failed: false,
      }
    case 'callout':
      return {
        block: 'callout',
        kind: 'tip',
        text: 'Remember: temperature stays constant during a phase change — the added energy goes into breaking intermolecular bonds.',
      }
    case 'code':
      return {
        block: 'code',
        language: 'python',
        code: `def phase_of_water(temp_c: float) -> str:\n    """Return the phase of water at standard pressure."""\n    if temp_c <= 0:\n        return "solid"\n    if temp_c < 100:\n        return "liquid"\n    return "gas"\n\nfor t in (-10, 25, 120):\n    print(t, phase_of_water(t))`,
      }
    case 'table':
      return {
        block: 'table',
        rows: [
          ['Substance', 'Melting point (°C)', 'Boiling point (°C)'],
          ['Water', '0', '100'],
          ['Ethanol', '-114', '78'],
          ['Iron', '1538', '2862'],
        ],
      }
    case 'flashcard':
      return {
        block: 'flashcard',
        cards: [
          {
            id: uid('fc'),
            front: { text: 'What is sublimation?', imageUrl: null, altText: '' },
            back: { text: 'A phase change directly from solid to gas, skipping the liquid phase — e.g. dry ice.', imageUrl: null, altText: '' },
          },
          {
            id: uid('fc'),
            front: { text: 'What happens to particle energy during melting?', imageUrl: null, altText: '' },
            back: { text: 'Particles absorb energy and vibrate faster until they break out of their fixed positions.', imageUrl: null, altText: '' },
          },
        ],
      }
    case 'graph':
      return {
        block: 'graph',
        kind: 'bar',
        title: 'Boiling Points of Common Substances',
        xLabel: 'Substance',
        yLabel: 'Boiling point (°C)',
        points: [
          { id: uid('pt'), label: 'Water', value: 100, x: 18 },
          { id: uid('pt'), label: 'Ethanol', value: 78, x: 46 },
          { id: uid('pt'), label: 'Acetone', value: 56, x: 58 },
          { id: uid('pt'), label: 'Mercury', value: 357, x: 200 },
        ],
      }
    case 'equation':
      return {
        block: 'equation',
        latex: 'Q = m L_f',
        explanation:
          'The heat Q required to melt a substance equals its mass m times the latent heat of fusion L_f.',
        invalid: false,
      }
    case 'question':
      return sampleQuestionData(qKind ?? 'multiple-choice')
    case 'mindmap':
      return {
        block: 'mindmap',
        nodes: [
          { id: 'mm-center', text: 'States of Matter', x: 420, y: 150, color: '#dca2fd', collapsed: false },
          { id: 'mm-solid', text: 'Solid', x: 160, y: 60, color: '#a2c5fd', collapsed: false },
          { id: 'mm-liquid', text: 'Liquid', x: 160, y: 240, color: '#a2fdc5', collapsed: false },
          { id: 'mm-gas', text: 'Gas', x: 680, y: 60, color: '#fdd7a2', collapsed: false },
          { id: 'mm-plasma', text: 'Plasma', x: 680, y: 240, color: '#fda2a2', collapsed: false },
        ],
        edges: [
          { id: uid('me'), from: 'mm-center', to: 'mm-solid' },
          { id: uid('me'), from: 'mm-center', to: 'mm-liquid' },
          { id: uid('me'), from: 'mm-center', to: 'mm-gas' },
          { id: uid('me'), from: 'mm-center', to: 'mm-plasma' },
        ],
      }
    case 'interactive':
      return { block: 'interactive', title: 'Particle Motion Simulator' }
  }
}
