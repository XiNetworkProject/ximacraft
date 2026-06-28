import { CloudMass, CloudEnvironment } from "./CloudMass";

/**
 * Gestionnaire des masses nuageuses convectives.
 *
 * Fait avancer la simulation de chaque {@link CloudMass}, retire celles qui se
 * sont dissipées, et expose la liste des masses pour le rendu (qui itère leurs
 * puffs). C'est le point d'entrée des commandes /cloud convective.
 */
export class ConvectiveCloudSystem {
  readonly masses: CloudMass[] = [];

  update(dt: number, env: CloudEnvironment): void {
    for (let i = this.masses.length - 1; i >= 0; i -= 1) {
      const mass = this.masses[i];
      mass.step(dt, env);
      if (mass.dead) this.masses.splice(i, 1);
    }
  }

  /** Petit cumulus naissant (une thermique amorcée, reste modeste). */
  spawnSmall(x: number, z: number): CloudMass {
    const mass = new CloudMass(x, z, { humidity: 0.5, instability: 0.3 });
    this.masses.push(mass);
    return mass;
  }

  spawnAt(x: number, z: number, options: { humidity?: number; instability?: number } = {}): CloudMass {
    const mass = new CloudMass(x, z, options);
    this.masses.push(mass);
    return mass;
  }

  /** Masse la plus proche d'un point (pour les commandes ciblées). */
  nearest(x: number, z: number): CloudMass | null {
    let best: CloudMass | null = null;
    let bestD = Infinity;
    for (const mass of this.masses) {
      const d = (mass.position.x - x) ** 2 + (mass.position.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = mass;
      }
    }
    return best;
  }

  clear(): void {
    this.masses.length = 0;
  }

  totalPuffs(): number {
    let n = 0;
    for (const mass of this.masses) n += mass.puffs.length;
    return n;
  }
}

export type { CloudEnvironment };
