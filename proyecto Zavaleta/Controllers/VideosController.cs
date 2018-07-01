using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;
using System.Web.Mvc;

namespace proyecto_Zavaleta.Controllers
{
    public class VideosController : Controller
    {
        // GET: Videos
        public ActionResult Index()
        {
            return View();
        }
    }
}