export interface DeveloperEntry {
  nameKey: string;
  roleKey: string;
  affiliationKey: string | null;
  photoUrl: string | null;
  initials: string;
  avatarColor: string;
  link: string;
}

export interface PublicationEntry {
  title: string;
  authors: string;
  journal: string;
  year: number;
  doi: string;
}

export function getDeveloperEntries(): DeveloperEntry[] {
  return [
    {
      nameKey: 'login.developers.anniaGalano',
      roleKey: 'login.developers.roleDirector',
      affiliationKey: 'login.developers.affUAM',
      photoUrl: 'assets/team/annia-galano.png',
      initials: 'AG',
      avatarColor: '#4A725A',
      link: 'https://agalano.com/',
    },
    {
      nameKey: 'login.developers.miguelReina',
      roleKey: 'login.developers.roleResearcher',
      affiliationKey: 'login.developers.affUNAM',
      photoUrl: 'assets/team/miguel-reina.jpg',
      initials: 'MR',
      avatarColor: '#003C71',
      link: 'https://scholar.google.com.mx/citations?user=6icbJxoAAAAJ&hl=es',
    },
    {
      nameKey: 'login.developers.luisAyala',
      roleKey: 'login.developers.roleResearcher',
      affiliationKey: 'login.developers.affUNAM',
      photoUrl: 'assets/team/luis-ayala.jpeg',
      initials: 'LF',
      avatarColor: '#003C71',
      link: 'https://scholar.google.com.mx/citations?user=TXDPjp4AAAAJ&hl=es',
    },
    {
      nameKey: 'login.developers.cesarGuzman',
      roleKey: 'login.developers.roleDeveloper',
      affiliationKey: null,
      photoUrl: 'assets/team/cesar-guzman.jpeg',
      initials: 'CG',
      avatarColor: '#6E967E',
      link: 'https://github.com/CesarGuzmanLopez',
    },
    {
      nameKey: 'login.developers.eduardoGuzman',
      roleKey: 'login.developers.roleCreator',
      affiliationKey: null,
      photoUrl: 'assets/team/eduardo-guzman.png',
      initials: 'EG',
      avatarColor: '#317154',
      link: 'https://scholar.google.com.mx/citations?user=yPVWngwAAAAJ&hl=es',
    },
  ];
}

export function getPublicationEntries(): PublicationEntry[] {
  return [
    {
      title: 'CADMA-Chem: A Computational Protocol Based on Chemical Properties Aimed to Design Multifunctional Antioxidants',
      authors: 'Guzmán-López, E. G., Reina, M., Pérez-González, A., Francisco-Márquez, M., Hernández-Ayala, L., Castañeda-Arriaga, R., Galano, A.',
      journal: 'Int. J. Mol. Sci.',
      year: 2022,
      doi: 'https://doi.org/10.3390/ijms232113246',
    },
    {
      title: 'A Computational Methodology for Accurate Predictions of Rate Constants in Solution: Application to Primary Antioxidant Activity',
      authors: 'Galano, A., Alvarez-Idaboy, J. R.',
      journal: 'J. Comput. Chem.',
      year: 2013,
      doi: 'https://doi.org/10.1002/jcc.23409',
    },
    {
      title: 'Antioxidants: The Chemical Complexity Behind a Simple Word',
      authors: 'Galano, A.',
      journal: 'Acc. Chem. Res.',
      year: 2025,
      doi: 'https://doi.org/10.1021/acs.accounts.5c00552',
    },
    {
      title: 'Antioxidant Activity at the Molecular Level: Exploring Ways of Action and Computational Tools to Investigate Them',
      authors: 'Galano, A.',
      journal: 'Chem. Sci.',
      year: 2025,
      doi: 'https://doi.org/10.1039/D5SC05463J',
    },
  ];
}
