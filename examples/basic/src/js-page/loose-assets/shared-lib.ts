// ts library files can live anywhere in the src directory, and they are only included
// when a ts page or client bundle imports them.

interface SharedData {
  shared: string;
}

const sharedLib: SharedData = {
  shared: 'data',
}

export default sharedLib
