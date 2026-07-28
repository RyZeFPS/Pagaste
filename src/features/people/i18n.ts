const peopleCopy = {
  es: {
    intro: 'Elige una persona reciente o añádela solo con su nombre.',
    habitualGroup: 'Personas del grupo',
    recent: 'Recientes',
    favorite: 'Favorito',
    favoriteAdd: 'Guardar como favorito',
    favoriteRemove: 'Quitar de favoritos',
    alreadyAdded: 'Ya está en el gasto',
    duplicateTitle: 'Esta persona parece estar añadida',
    duplicateBody: (candidate: string, existing: string) =>
      `${candidate} coincide con ${existing}. Usa la persona existente para evitar duplicados.`,
    duplicateUse: 'Usar existente',
    duplicateCancel: 'Revisar nombre',
    noSuggestions: 'Cuando compartas más gastos, aquí aparecerán personas recientes.',
    loading: 'Buscando personas…',
    addFailed: 'No se ha podido añadir.',
    invalidName: 'Escribe un nombre válido.',
    suggestionA11y: (name: string) => `Añadir a ${name}`,
  },
  en: {
    intro: 'Choose someone recent or add them with just their name.',
    habitualGroup: 'People in the group',
    recent: 'Recent',
    favorite: 'Favorite',
    favoriteAdd: 'Save as favorite',
    favoriteRemove: 'Remove from favorites',
    alreadyAdded: 'Already in this expense',
    duplicateTitle: 'This person may already be added',
    duplicateBody: (candidate: string, existing: string) =>
      `${candidate} matches ${existing}. Use the existing person to avoid duplicates.`,
    duplicateUse: 'Use existing',
    duplicateCancel: 'Review name',
    noSuggestions: 'People you share expenses with will appear here.',
    loading: 'Finding people…',
    addFailed: 'We could not add this person.',
    invalidName: 'Enter a valid name.',
    suggestionA11y: (name: string) => `Add ${name}`,
  },
} as const;

export function getPeopleCopy(locale: string) {
  return locale === 'en' ? peopleCopy.en : peopleCopy.es;
}
