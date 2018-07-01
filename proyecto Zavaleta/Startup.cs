using Microsoft.Owin;
using Owin;

[assembly: OwinStartupAttribute(typeof(proyecto_Zavaleta.Startup))]
namespace proyecto_Zavaleta
{
    public partial class Startup
    {
        public void Configuration(IAppBuilder app)
        {
            ConfigureAuth(app);
        }
    }
}
