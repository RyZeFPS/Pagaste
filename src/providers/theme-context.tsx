import { createContext, useContext } from 'react';
import { colors, type AppColors } from '@/theme';

export const ThemeContext = createContext<AppColors>(colors.light);

export const useAppColors = () => useContext(ThemeContext);
