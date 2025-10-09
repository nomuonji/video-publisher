import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ children, className = '', footer }) => (
  <div className={`bg-slate-800 rounded-lg shadow-lg ${className}`}>
    <div className="p-6">
      {children}
    </div>
    {footer && (
      <div className="bg-slate-800/50 px-6 py-4 border-t border-slate-700 rounded-b-lg">
        {footer}
      </div>
    )}
  </div>
);
