const membersSlider = document.getElementById('members-slider');
const panelsSlider = document.getElementById('panels-slider');
const membersOutput = document.getElementById('members-output');
const panelsOutput = document.getElementById('panels-output');
const energySavingsTarget = document.getElementById('energy-savings');
const hempcreteTarget = document.getElementById('hempcrete-use');
const carbonTarget = document.getElementById('carbon-credits');
const reinvestmentTarget = document.getElementById('reinvestment');
const stipendsTarget = document.getElementById('stipends-amount');
const grantsTarget = document.getElementById('grants-amount');
const dividendTarget = document.getElementById('dividend-amount');
const baselineEnergyTarget = document.getElementById('baseline-energy');
const scenarioEnergyTarget = document.getElementById('scenario-energy');
const deltaEnergyTarget = document.getElementById('delta-energy');
const baselineHempcreteTarget = document.getElementById('baseline-hempcrete');
const scenarioHempcreteTarget = document.getElementById('scenario-hempcrete');
const deltaHempcreteTarget = document.getElementById('delta-hempcrete');
const baselineCarbonTarget = document.getElementById('baseline-carbon');
const scenarioCarbonTarget = document.getElementById('scenario-carbon');
const deltaCarbonTarget = document.getElementById('delta-carbon');
const baselineReinvestmentTarget = document.getElementById('baseline-reinvestment');
const scenarioReinvestmentTarget = document.getElementById('scenario-reinvestment');
const deltaReinvestmentTarget = document.getElementById('delta-reinvestment');
const dashboardYear = document.getElementById('dashboard-year');

const BASELINE = {
  members: 100,
  panels: 180,
};

const CONSTANTS = {
  energyPerPanelKwh: 4200, // annual production per panel
  savingsPerKwh: 0.18, // retail value of each kWh displaced ($)
  hempcretePerMember: 1.4, // bales dedicated to each member household retrofit
  hempcretePerPanel: 0.15, // supplemental hempcrete for battery and market envelope
  carbonCreditsPerPanel: 0.85, // metric tons avoided per panel per year
  carbonCreditValue: 42, // average $ per carbon credit sold in a neighborhood bundle
  duesPerMember: 120, // annual cooperative dues per member household ($)
  reinvestmentShareFromDues: 0.7,
  reinvestmentShareFromEnergy: 0.35,
  reinvestmentShareFromCredits: 0.5,
  stipendShare: 0.65,
  grantsShare: 0.2,
  dividendShare: 0.15,
};

function toNumber(input) {
  if (!input) return 0;
  const value = Number.parseInt(input.value, 10);
  if (Number.isNaN(value)) {
    return 0;
  }
  return value;
}

function formatNumber(value) {
  return Math.round(value).toLocaleString();
}

function formatDecimal(value, fractionDigits = 1) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatCurrency(value) {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function calculateScenario({ members, panels }) {
  const energyKwh = panels * CONSTANTS.energyPerPanelKwh;
  const energyValue = energyKwh * CONSTANTS.savingsPerKwh;

  const hempcreteBales = members * CONSTANTS.hempcretePerMember + panels * CONSTANTS.hempcretePerPanel;

  const carbonCredits = panels * CONSTANTS.carbonCreditsPerPanel;
  const carbonValue = carbonCredits * CONSTANTS.carbonCreditValue;

  const reinvestmentFromDues = members * CONSTANTS.duesPerMember * CONSTANTS.reinvestmentShareFromDues;
  const reinvestmentFromEnergy = energyValue * CONSTANTS.reinvestmentShareFromEnergy;
  const reinvestmentFromCredits = carbonValue * CONSTANTS.reinvestmentShareFromCredits;
  const totalReinvestment = reinvestmentFromDues + reinvestmentFromEnergy + reinvestmentFromCredits;

  return {
    members,
    panels,
    energyKwh,
    energyValue,
    hempcreteBales,
    carbonCredits,
    carbonValue,
    totalReinvestment,
  };
}

function renderScenario() {
  if (
    !membersSlider ||
    !panelsSlider ||
    !membersOutput ||
    !panelsOutput ||
    !energySavingsTarget ||
    !hempcreteTarget ||
    !carbonTarget ||
    !reinvestmentTarget ||
    !stipendsTarget ||
    !grantsTarget ||
    !dividendTarget ||
    !baselineEnergyTarget ||
    !scenarioEnergyTarget ||
    !deltaEnergyTarget ||
    !baselineHempcreteTarget ||
    !scenarioHempcreteTarget ||
    !deltaHempcreteTarget ||
    !baselineCarbonTarget ||
    !scenarioCarbonTarget ||
    !deltaCarbonTarget ||
    !baselineReinvestmentTarget ||
    !scenarioReinvestmentTarget ||
    !deltaReinvestmentTarget
  ) {
    return;
  }

  const current = {
    members: toNumber(membersSlider),
    panels: toNumber(panelsSlider),
  };

  const scenario = calculateScenario(current);
  const baseline = calculateScenario(BASELINE);

  membersOutput.textContent = `${scenario.members.toLocaleString()} member-owners`;
  panelsOutput.textContent = `${scenario.panels.toLocaleString()} panels`;

  energySavingsTarget.textContent = `${formatNumber(scenario.energyKwh)} kWh`;
  hempcreteTarget.textContent = `${formatNumber(scenario.hempcreteBales)} bales`;
  carbonTarget.textContent = `${formatDecimal(scenario.carbonCredits, 1)} credits`;
  reinvestmentTarget.textContent = formatCurrency(scenario.totalReinvestment);

  const stipends = scenario.totalReinvestment * CONSTANTS.stipendShare;
  const grants = scenario.totalReinvestment * CONSTANTS.grantsShare;
  const dividend = scenario.totalReinvestment * CONSTANTS.dividendShare;

  stipendsTarget.textContent = formatCurrency(stipends);
  grantsTarget.textContent = formatCurrency(grants);
  dividendTarget.textContent = formatCurrency(dividend);

  baselineEnergyTarget.textContent = `${formatNumber(baseline.energyKwh)} kWh`;
  scenarioEnergyTarget.textContent = `${formatNumber(scenario.energyKwh)} kWh`;
  deltaEnergyTarget.textContent = deltaLabel(scenario.energyKwh - baseline.energyKwh, 'kWh');

  baselineHempcreteTarget.textContent = `${formatNumber(baseline.hempcreteBales)} bales`;
  scenarioHempcreteTarget.textContent = `${formatNumber(scenario.hempcreteBales)} bales`;
  deltaHempcreteTarget.textContent = deltaLabel(scenario.hempcreteBales - baseline.hempcreteBales, 'bales');

  baselineCarbonTarget.textContent = `${formatDecimal(baseline.carbonCredits, 1)} credits`;
  scenarioCarbonTarget.textContent = `${formatDecimal(scenario.carbonCredits, 1)} credits`;
  deltaCarbonTarget.textContent = deltaLabel(scenario.carbonCredits - baseline.carbonCredits, 'credits', 1);

  baselineReinvestmentTarget.textContent = formatCurrency(baseline.totalReinvestment);
  scenarioReinvestmentTarget.textContent = formatCurrency(scenario.totalReinvestment);
  deltaReinvestmentTarget.textContent = deltaCurrencyLabel(scenario.totalReinvestment - baseline.totalReinvestment);
}

function deltaLabel(value, unit, fractionDigits = 0) {
  const formattedValue =
    fractionDigits > 0 ? formatDecimal(Math.abs(value), fractionDigits) : formatNumber(Math.abs(value));
  if (value === 0) {
    return 'No change';
  }
  const prefix = value > 0 ? '+' : '−';
  const unitLabel = unit ? ` ${unit}` : '';
  return `${prefix}${formattedValue}${unitLabel}`;
}

function deltaCurrencyLabel(value) {
  if (value === 0) {
    return 'No change';
  }
  const prefix = value > 0 ? '+' : '−';
  const absolute = Math.abs(value);
  return `${prefix}${formatCurrency(absolute)}`;
}

if (membersSlider && panelsSlider) {
  membersSlider.addEventListener('input', renderScenario);
  panelsSlider.addEventListener('input', renderScenario);
  renderScenario();
}

if (dashboardYear) {
  dashboardYear.textContent = new Date().getFullYear().toString();
}
